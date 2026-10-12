// ───────────────────────── shaders ─────────────────────────
const MAXL = 24;

const GLSL_COMMON = `
precision highp float; precision highp int; precision highp sampler2D;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
vec3 enc(vec3 c){ return sqrt(clamp(c*.25,0.,1.)); }
vec3 dec(vec3 c){ return c*c*4.; }
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
`;

const VS_FULL = `#version 300 es
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`;

// ── scene: G-buffer pass (also used for the mirrored reflection pass)
const VS_SCENE = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in vec3 aM;
uniform mat4 uVP, uModel; uniform float uMirror;
out vec3 vW; out vec3 vN; out vec3 vC; flat out vec3 vM;
void main(){
  vec4 w = uModel*vec4(aP,1.);
  vN = mat3(uModel)*aN; vW = w.xyz; vC = aC; vM = aM;
  if(uMirror>.5) w.y = -w.y;
  gl_Position = uVP*w;
}`;

const FS_SCENE = `#version 300 es
${GLSL_COMMON}
in vec3 vW; in vec3 vN; in vec3 vC; flat in vec3 vM;
uniform vec3 uCam; uniform float uTime, uMirror, uFar, uWet, uFog; uniform vec2 uRes;
uniform sampler2D uRefl;
uniform vec4 uLP[${MAXL}]; uniform vec4 uLC[${MAXL}]; uniform int uNL;
uniform vec3 uMoon; uniform vec3 uFogC; uniform vec3 uAmbTop, uAmbBot;
uniform vec4 uRip[8];  // rain / koi ripples: xz, age, strength
uniform vec4 uOcc;     // see-through cut: player head xyz, radius
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;

vec3 lighting(vec3 p, vec3 n, vec3 base){
  vec3 acc = mix(uAmbBot, uAmbTop, n.y*.5+.5);
  acc += vec3(.12,.14,.24)*max(dot(n,uMoon),0.);
  for(int i=0;i<${MAXL};i++){
    if(i>=uNL) break;
    vec3 d = uLP[i].xyz-p; float dist=length(d);
    float att = max(0., 1.-dist/uLP[i].w); att*=att;
    float nd = max(dot(n,d/max(dist,1e-3)),0.)*.8+.2;
    acc += uLC[i].rgb*att*nd;
  }
  return base*acc;
}
float ripples(vec2 xz){
  float r=0.;
  for(int i=0;i<8;i++){
    vec4 R=uRip[i]; if(R.w<=0.) continue;
    float d=length(xz-R.xy), rad=R.z*1.6;
    r += sin((d-rad)*14.)*exp(-abs(d-rad)*6.)*R.w*max(0.,1.-R.z*.8);
  }
  return r;
}
void main(){
  if(uMirror>.5 && vW.y < -.02) discard;
  // anything between the camera and the traveller is cut away, with a dithered rim
  if(uMirror<.5 && uOcc.w>0.){
    vec3 ab=uOcc.xyz-uCam; float tt=clamp(dot(vW-uCam,ab)/dot(ab,ab),0.,1.);
    float dd=length(vW-(uCam+ab*tt));
    float rim=uOcc.w*(.82+.18*hash12(floor(gl_FragCoord.xy*.5)));
    if(tt<.9 && dd<rim && vW.y>.3) discard;
  }
  int mat=int(vM.x+.5); float e=vM.y; int pat=int(vM.z+.5);
  vec3 n=normalize(vN), p=vW, base=vC;
  vec2 fq = vec2(abs(n.x)>abs(n.z)? p.z : p.x, p.y);   // facade-space coords
  if(pat==1){            // stone paving, staggered
    vec2 q=p.xz/vec2(1.15,.8); q.x+=floor(q.y)*.5; vec2 f=fract(q);
    float g=min(min(f.x,1.-f.x)*1.15, min(f.y,1.-f.y)*.8);
    base*=mix(.55,1.,smoothstep(.025,.06,g))*(.85+.25*hash12(floor(q)));
  } else if(pat==2){     // vertical grain / planks
    float u=dot(p.xz,vec2(1.)); base*=.78+.22*step(.14,fract(u*3.1));
  } else if(pat==3){     // office facade with windows
    vec2 q=fq/vec2(1.6,3.); vec2 id=floor(q), f=fract(q);
    bool win = f.x>.16&&f.x<.84&&f.y>.28&&f.y<.84&&abs(n.y)<.5&&p.y>3.4;
    if(win){
      float h=hash12(id+floor(p.x*.05)*17.+floor(p.z*.05)*31.);
      if(h>.52){ base=mix(vec3(1.,.72,.42),vec3(.62,.82,1.),step(.82,h)); e=max(e,.35+.4*fract(h*7.)); }
      else base=vec3(.025,.03,.05);
    } else base*=.85+.25*hash12(floor(fq*3.));
  } else if(pat==4){     // kawara roof tiles: ridges running down the slope
    float u=abs(n.x)>abs(n.z)? p.z : p.x;
    base*=.55+.6*smoothstep(.15,.55,abs(fract(u*2.4)-.5)*2.);
  } else if(pat==5){     // paper lantern ribs
    base*=.62+.38*smoothstep(.1,.4,abs(fract(p.y*3.4)-.5)*2.);
  } else if(pat==6){     // asphalt grain
    base*=.75+.5*hash12(floor(p.xz*5.));
  } else if(pat==7){     // shoji / lattice
    vec2 f=fract(fq*vec2(2.4,1.7));
    base*=(min(f.x,1.-f.x)<.07||min(f.y,1.-f.y)<.07)? .3 : 1.;
  } else if(pat==9){     // vending machine: rows of cans
    vec2 q=fq*vec2(5.,4.2); vec2 c=floor(q), f=fract(q);
    float can=step(.22,f.x)*step(f.x,.78)*step(.12,f.y)*step(f.y,.66);
    vec3 cc=.55+.45*cos(6.28*(hash12(c)+vec3(0.,.33,.67)));
    base=mix(base,cc,can);
  }
  vec3 col = lighting(p,n,base) + base*e*2.4;
  vec2 suv = gl_FragCoord.xy/uRes;
  vec3 V = normalize(uCam-p);
  if(mat==5){            // pond water: planar reflection + ripples
    vec2 w=vec2(vnoise(p.xz*1.2+vec2(uTime*.35,0.)), vnoise(p.xz*1.1-vec2(0.,uTime*.3)))-.5;
    float rp=ripples(p.xz);
    vec3 r=dec(texture(uRefl, suv+w*.018+vec2(0.,rp*.012)).rgb);
    float fr=mix(.55,1.,pow(1.-max(V.y,0.),2.));
    col = mix(base*.25+col*.2, r, fr) + vec3(.6,.7,1.)*max(rp,0.)*.25;
  } else if((mat==1||mat==2) && uWet>0. && n.y>.9){   // wet street, puddles
    float pud=smoothstep(.58,.72, vnoise(p.xz*.3)+.22*vnoise(p.xz*1.6)) * uWet;
    vec2 w=vec2(vnoise(p.xz*2.+uTime*.2), vnoise(p.xz*2.3-uTime*.2))-.5;
    float rp=ripples(p.xz);
    vec3 r=dec(texture(uRefl, suv+w*.006*(1.-pud)+vec2(0.,rp*.008)).rgb);
    col = mix(col + r*.1*uWet, r*.95 + col*.12, pud*.92);
    if(pud>.5) mat=5;
  }
  float dist=length(uCam-p);
  col = mix(col, uFogC, (1.-exp(-dist*uFog))*(1.-clamp(e,0.,1.)*.6));
  float d=clamp(dist/uFar,0.,1.);
  o0=vec4(enc(col), clamp(e,0.,1.));
  o1=vec4(float(mat)/255., floor(d*255.)/255., fract(d*255.), n.y*.5+.5);
}`;

// ── sky: drawn first, full-screen, writes material 0 and far depth
const FS_SKY = `#version 300 es
${GLSL_COMMON}
uniform vec3 uFwd,uRight,uUp,uMoon; uniform vec2 uTan,uRes; uniform float uMirror,uTime,uRain;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
vec3 sky(vec3 d){
  float h=d.y;
  vec3 zen=vec3(.012,.016,.05), mid=vec3(.05,.035,.11), hor=vec3(.32,.12,.2);
  vec3 c=mix(mid,zen,smoothstep(.05,.7,h));
  c=mix(hor,c,smoothstep(-.02,.22,h));
  c+=vec3(.5,.2,.08)*exp(-max(h,0.)*14.)*.35;                 // Tokyo light pollution
  // drifting cloud bands lit from below by the city
  vec2 cp=d.xz/max(h,.06)*1.3+vec2(uTime*.02,uTime*.006);
  float cl=smoothstep(.45,.85,vnoise(cp*.7)*.65+vnoise(cp*1.9)*.35);
  c=mix(c, vec3(.16,.08,.16)+vec3(.12,.06,.03)*(1.-h), cl*smoothstep(.02,.25,h)*(.55+uRain*.4));
  // distant skyline + Tokyo Skytree (matte painting: only ever seen high up, or in reflections)
  float az=atan(d.x,-d.z), el=asin(clamp(h,-1.,1.));
  float bh=.018+.03*pow(vnoise(vec2(az*38.,1.)),2.)+.02*step(.82,vnoise(vec2(az*9.,7.)));
  if(el<bh){ vec2 wq=vec2(az*900.,el*900.); float win=step(.86,hash12(floor(wq)))*step(.3,fract(wq.x))*step(.3,fract(wq.y));
    c=mix(vec3(.02,.018,.035),vec3(1.,.75,.45)*.7,win*.6); }
  float ta=az-.34, te=el;
  float tw=.012*(1.-te/.95)+.004;                                       // tapering shaft
  tw+=.011*exp(-pow((te-.45)/.012,2.))+.008*exp(-pow((te-.6)/.01,2.));  // the two observation decks
  if(te<.92 && te>-.05 && abs(ta)<tw){
    float band=.5+.5*sin(te*90.-uTime*1.2);
    vec3 led=mix(vec3(.35,.55,1.),vec3(.75,.35,1.),band);
    float lattice=step(.5,fract((te+abs(ta)*3.)*140.))*.5+.5;
    c=led*(.5+.6*lattice)*(1.-step(.83,te)*.4);
    if(abs(te-.45)<.012||abs(te-.6)<.01) c=vec3(.9,.95,1.)*1.6;           // deck rings
  }
  if(abs(ta)<.004 && te>.92 && te<.97) c=vec3(1.,.2,.15)*(step(.5,fract(uTime*.8))*2.+.2); // aviation light
  // stars
  vec3 sd=d*150.; vec3 id=floor(sd); float hs=hash13(id);
  if(hs>.986){ vec3 f=fract(sd)-.5; float s=smoothstep(.32,.0,length(f));
    float tw=.6+.4*sin(uTime*(2.+hs*9.)+hs*60.);
    c+=vec3(.75,.82,1.)*s*tw*(1.-cl)*smoothstep(.08,.4,h)*(1.-uRain)*3.; }
  // moon + halo
  float md=dot(d,uMoon);
  c+=vec3(1.,.93,.8)*smoothstep(.99955,.9998,md)*3.;
  c+=vec3(.25,.25,.4)*pow(max(md,0.),300.)*.8 + vec3(.1,.1,.2)*pow(max(md,0.),20.)*.25;
  return c;
}
void main(){
  vec2 ndc=gl_FragCoord.xy/uRes*2.-1.;
  vec3 d=normalize(uFwd+ndc.x*uTan.x*uRight+ndc.y*uTan.y*uUp);
  if(uMirror>.5) d.y=-d.y;
  vec3 c=sky(d);
  float md=dot(d,uMoon);
  float az=atan(d.x,-d.z), el=asin(clamp(d.y,-1.,1.));
  float tower=step(abs(az-.34),.03)*step(el,.97)*step(.0,el);
  o0=vec4(enc(c), max(smoothstep(.9994,.9998,md), tower*.7));
  o1=vec4(0.,1.,0.,1.);
}`;

// ── emissive downsample to cell resolution (source of the glow)
const FS_EMIT = `#version 300 es
${GLSL_COMMON}
uniform sampler2D uG0; uniform ivec2 uS;
out vec4 o;
void main(){
  ivec2 b=ivec2(gl_FragCoord.xy)*uS; vec3 s=vec3(0.);
  for(int y=0;y<uS.y;y++) for(int x=0;x<uS.x;x++){ vec4 g=texelFetch(uG0,b+ivec2(x,y),0); s+=dec(g.rgb)*g.a; }
  o=vec4(enc(s/float(uS.x*uS.y)),1.);
}`;

const FS_BLUR = `#version 300 es
${GLSL_COMMON}
uniform sampler2D uT; uniform vec2 uDir; uniform vec2 uSize;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/uSize, px=uDir/uSize;
  vec3 s=dec(texture(uT,uv).rgb)*.227;
  s+=(dec(texture(uT,uv+px*1.385).rgb)+dec(texture(uT,uv-px*1.385).rgb))*.316;
  s+=(dec(texture(uT,uv+px*3.231).rgb)+dec(texture(uT,uv-px*3.231).rgb))*.070;
  o=vec4(enc(s),1.);
}`;

// ── the ASCII pass: one fragment per character cell
const FS_ASCII = `#version 300 es
${GLSL_COMMON}
uniform sampler2D uG0,uG1,uGlow,uShape,uCS;
uniform ivec2 uS; uniform float uTime, uExpo, uBloomAscii, uReveal, uDetail; uniform ivec2 uCells;
float tlv(float L){ return clamp((log2(max(L*uExpo,1e-6))+6.9)/7.9,0.,1.); }
uniform int uEdge[24]; uniform int uEdgeN;
layout(location=0) out vec4 c0; layout(location=1) out vec4 c1; layout(location=2) out vec4 c2;
#define MAXS 48
int cs(int row,int lv){ return int(texelFetch(uCS,ivec2(clamp(lv,0,15),row),0).r*255.+.5); }
vec3 vivid(vec3 c,float l){
  float m=max(max(c.r,c.g),c.b); vec3 h=c/max(m,1e-4);
  h=mix(vec3(dot(h,vec3(.333))),h,1.15);
  return max(h,0.)*(.14+.98*l);
}
void main(){
  ivec2 cell=ivec2(gl_FragCoord.xy), b0=cell*uS;
  int n=uS.x*uS.y, ci=(uS.y/2)*uS.x+uS.x/2;
  float dep[MAXS]; int mt[MAXS]; vec3 cl[MAXS];
  float dmin=2., dmax=-1., emi=0., nys=0.; vec3 sum=vec3(0.);
  int k=0;
  for(int y=0;y<uS.y;y++) for(int x=0;x<uS.x;x++){
    vec4 g0=texelFetch(uG0,b0+ivec2(x,y),0), g1=texelFetch(uG1,b0+ivec2(x,y),0);
    vec3 c=dec(g0.rgb); float d=g1.g+g1.b/255.;
    cl[k]=c; dep[k]=d; mt[k]=int(g1.r*255.+.5);
    dmin=min(dmin,d); dmax=max(dmax,d); sum+=c; emi+=g0.a; nys+=g1.a; k++;
  }
  float fn=float(n); vec3 avg=sum/fn; emi/=fn; float ny=nys/fn*2.-1.;
  int mat=mt[ci]; float dc=dep[ci];
  float L=lum(avg), lv=tlv(L);
  int glyph=0; vec3 fg=vec3(0.), bg=vivid(avg,lv)*.13;
  float hs=hash12(vec2(cell)+.5);
  bool edge=false;
  // ---- silhouettes: match the foreground mask against glyph shapes
  if((dmax-dmin)/max(dmin,1e-3)>.07){
    float mid=(dmin+dmax)*.5; int fc=0, fmat=0; vec3 fs=vec3(0.), bs=vec3(0.);
    for(int i=0;i<MAXS;i++){ if(i>=n) break; if(dep[i]<mid){ fc++; fs+=cl[i]; fmat=mt[i]; } else bs+=cl[i]; }
    if(fc>0 && fc<n && fmat!=4 && fmat!=5 && fmat!=0 && fmat!=11){
      float best=1e9; int bgl=0;
      for(int j=0;j<24;j++){ if(j>=uEdgeN) break; int g=uEdge[j]; float e2=0.;
        for(int i=0;i<MAXS;i++){ if(i>=n) break; float s=texelFetch(uShape,ivec2(g,i),0).r; float m=dep[i]<mid?1.:0.; e2+=(m-s)*(m-s); }
        if(e2<best){ best=e2; bgl=g; } }
      vec3 fcol=fs/float(fc); float fl=tlv(lum(fcol));
      if(fl>.08){ glyph=bgl; edge=true; fg=vivid(fcol,max(fl,.3)); vec3 bc=bs/float(n-fc); bg=vivid(bc,tlv(lum(bc)))*.13; mat=fmat; }
    }
  }
  if(!edge){
    int lvl=int(lv*15.99);
    if(mat==4){              // lawn & moss: sparse tufts on dark ground; a slow gust leans them as it passes
      vec2 cq=vec2(cell)/uDetail;
      float tuft=vnoise(cq*vec2(.55,1.1)+3.7)*.65+hash12(vec2(cell)*.73)*.35;
      float gust=smoothstep(.72,1.,sin(cq.x*.16-cq.y*.07-uTime*.9)*.5+.5);
      float l2=lv*.85;
      if(l2<.07) glyph=0;
      else if(tuft<.44) glyph = hs>.86 ? 46-32 : 0;                       // bare ground, a few specks
      else if(tuft<.58) glyph = hs>.5 ? 44-32 : 46-32;                    // , .
      else if(tuft<.72) glyph = gust>.35 ? 47-32 : (hs>.5 ? 39-32 : 44-32); // ' ,  (/ in the gust)
      else glyph = gust>.35 ? 47-32 : (l2>.55 ? 118-32 : 34-32);          // tuft: " or v
    } else if(mat==5){       // water: rippling dashes, bright reflections become sparkles
      vec2 cw2=vec2(cell)/uDetail; float ph=sin(cw2.x*.5+cw2.y*1.7-uTime*1.3+hs*1.5)*.5+.5;
      if(lv<.05) glyph=0;
      else if(lv<.2) glyph= ph>.62? 45-32 : (ph>.35? 46-32 : 0);
      else if(lv<.45) glyph= ph>.5? 126-32 : 45-32;
      else if(lv<.75) glyph= ph>.5? 61-32 : 126-32;
      else glyph= ph>.6? 42-32 : 61-32;
    } else if(mat==9){       // neon: letters scrambling like a split-flap display
      float t=floor(uTime*(3.+hs*5.)+hs*20.);
      glyph = lv<.08? 0 : cs(16, int(hash12(vec2(cell)*1.37+t)*15.99));
    } else if(mat==10 && emi>.15){  // lit office windows: dense text
      float t=floor(uTime*.15+hs*40.);
      glyph=cs(17, int(hash12(vec2(cell)*.71+t)*15.99));
    } else if(mat==11){      // foliage: Q0Oo@ clusters like the reference, kept darker than lit surfaces
      lv*=.78;
      glyph = lv<.06? 0 : cs(11, clamp(int(lv*11.+hs*5.),0,15));
    } else if(mat==14){      // fire / embers flicker
      glyph = lv<.06? 0 : cs(14, clamp(int(lv*12.+hash12(vec2(cell)+floor(uTime*12.))*4.),0,15));
    } else if(mat==6 && abs(ny)<.35){  // lacquered pillars: vertical strokes
      glyph=cs(19,lvl);
    } else glyph=cs(mat,lvl);
    fg=vivid(avg,lv);
    if(mat==4) fg=mix(vec3(lum(fg)),fg,.6)*.78;   // moss: muted, never neon
  }
  // ---- glow: blurred emissive at cell resolution
  vec3 gw=dec(texelFetch(uGlow,cell,0).rgb);
  float gl=lum(gw);
  if(glyph==0 && gl*uBloomAscii>.035){ glyph=cs(18,int(clamp((gl*uBloomAscii-.035)*5.,0.,1.)*15.99)); fg=vivid(gw,clamp(gl*2.5,.2,1.)); }
  fg+=gw*.3; bg+=gw*.14;
  // boot reveal: cells resolve from the top down through a band of flickering vermilion letters
  if(uReveal<1.){
    float rv=hash12(vec2(cell)*.37+3.1)*.55+(1.-float(cell.y)/float(uCells.y))*.45;
    float e=rv-uReveal*1.12;
    if(e>0.){
      if(e<.1){ glyph=cs(16,int(hash12(vec2(cell)+floor(uTime*14.))*15.99)); fg=vec3(1.,.36,.2)*(1.-e*8.); bg=vec3(.05,.01,.01); emi=.6; }
      else { glyph=0; fg=vec3(0.); bg=vec3(0.); emi=0.; }
    }
  }
  c0=vec4(min(fg,vec3(1.2)), float(glyph)/255.);
  c1=vec4(min(bg,vec3(1.)), clamp(emi*1.3,0.,1.));
  c2=vec4(float(mat)/255., floor(dc*255.)/255., fract(dc*255.), 0.);
}`;

// ── final composite: glyph atlas + overlay (HUD, particles, signs) + halo
const FS_DISPLAY = `#version 300 es
${GLSL_COMMON}
uniform sampler2D uC0,uC1,uC2,uAtlas,uGlow,uO0,uO1,uU0,uU1,uAtlasUI;
uniform vec2 uCellPx, uOff, uScreen; uniform ivec2 uCells; uniform float uTime, uHalo, uFade;
out vec4 o;
void main(){
  vec2 fc=gl_FragCoord.xy-uOff, gp=vec2(uCells)*uCellPx;
  vec2 uvg=fc/gp;
  vec3 col=vec3(0.);
  if(fc.x>=0.&&fc.y>=0.&&fc.x<gp.x&&fc.y<gp.y){
    ivec2 cp=ivec2(uCellPx), cell=ivec2(fc)/cp, ip=ivec2(fc)-cell*cp;
    vec4 a=texelFetch(uC0,cell,0), b=texelFetch(uC1,cell,0);
    int g=int(a.a*255.+.5); vec3 fg=a.rgb, bg=b.rgb; float hal=b.a;
    vec4 oa=texelFetch(uO0,cell,0); int oc=int(oa.r*255.+.5);
    if(oc>0){
      int fl=int(oa.a*255.+.5); vec4 cc=texelFetch(uC2,cell,0);
      float od=oa.g+oa.b/255., sd=cc.g+cc.b/255.;
      bool vis=(fl&1)!=0 || od<=sd+.003;
      if((fl&4)!=0) vis=vis && int(cc.r*255.+.5)==5;
      if(vis){
        vec4 ob=texelFetch(uO1,cell,0);
        fg=ob.rgb; hal=max(hal,ob.a);
        if((fl&2)!=0) bg=fg*.10+vec3(.004,.004,.01);
        g=oc-32;
      }
    }
    ivec2 at=ivec2((g%16)*cp.x+ip.x, (g/16)*cp.y+(cp.y-1-ip.y));
    vec2 m=texelFetch(uAtlas,at,0).rg;
    col=bg+fg*m.r+fg*m.g*hal*.5;
    // coarse layer (2×2 fine cells): legible text, HUD, panels
    ivec2 up=cp*2, ucell=ivec2(fc)/up, uip=ivec2(fc)-ucell*up;
    vec4 ua=texelFetch(uU0,ucell,0); int uc=int(ua.r*255.+.5);
    if(uc>0){
      int fl=int(ua.a*255.+.5); vec4 cc=texelFetch(uC2,cell,0);
      float od=ua.g+ua.b/255., sd=cc.g+cc.b/255.;
      if((fl&1)!=0 || od<=sd+.003){
        vec4 ub=texelFetch(uU1,ucell,0); int ug=uc-32;
        ivec2 uat=ivec2((ug%16)*up.x+uip.x, (ug/16)*up.y+(up.y-1-uip.y));
        vec2 um=texelFetch(uAtlasUI,uat,0).rg;
        vec3 base=(fl&2)!=0 ? ub.rgb*.10+vec3(.004,.004,.01) : col*.3;
        col=base+ub.rgb*um.r+ub.rgb*um.g*ub.a*.85;
      }
    }
  }
  col+=dec(texture(uGlow,clamp(uvg,0.,1.)).rgb)*uHalo;
  vec2 q=gl_FragCoord.xy/uScreen-.5; col*=1.-dot(q,q)*.6;
  col*=uFade;
  col+=(hash12(gl_FragCoord.xy+fract(uTime*7.)*91.)-.5)*.01;
  o=vec4(pow(max(col,0.),vec3(.95)),1.);
}`;
