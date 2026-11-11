import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const $ = s => document.querySelector(s);
const menu=$("#menu"), inventory=$("#inventory"), chatInput=$("#chatInput");
let scene,camera,renderer,controls,ws,myId=null,joined=false;
let yaw=0, velocityY=0, onGround=false, lastMove=0, selected=0;
const keys={}, blockMeshes=new Map(), remote=new Map(), inventoryItems={grass:24,dirt:16,stone:8,wood:4,planks:0,sand:0};
const slots=["grass","dirt","stone","wood","planks","sand","leaves","grass","dirt"];
const colors={grass:0x65a943,dirt:0x80502e,stone:0x85898d,wood:0x76502e,planks:0xb58a4e,leaves:0x367b35,sand:0xd8c58b};
const emojis={grass:"🟩",dirt:"🟫",stone:"⬜",wood:"🪵",planks:"🟨",sand:"🏖️",leaves:"🌿"};
const world=new Map();
const key=(x,y,z)=>`${x},${y},${z}`;
const cubeGeometry=new THREE.BoxGeometry(1,1,1);
const blockMaterials=Object.fromEntries(Object.entries(colors).map(([name,color])=>[name,new THREE.MeshLambertMaterial({color})]));
let raycaster=new THREE.Raycaster();
let touchLook=null;
let moveForward=false,moveRight=false;
const playerHeight=1.7;

function terrainHeight(x,z){return Math.floor(3+Math.sin(x*.16)*2+Math.cos(z*.13)*2+Math.sin((x+z)*.08)*1.4);}
function addBlock(x,y,z,type,send=true){
  const k=key(x,y,z);
  if(world.has(k)) removeBlock(x,y,z,false);
  world.set(k,type);
  const mesh=new THREE.Mesh(cubeGeometry,blockMaterials[type]||blockMaterials.stone);mesh.position.set(x+.5,y+.5,z+.5);mesh.userData={x,y,z,type};
  scene.add(mesh);blockMeshes.set(k,mesh);
  if(send&&ws?.readyState===1)ws.send(JSON.stringify({type:"block",x,y,z,block:type}));
}
function removeBlock(x,y,z,send=true){
  const k=key(x,y,z),mesh=blockMeshes.get(k);
  if(mesh){scene.remove(mesh);blockMeshes.delete(k);}
  world.delete(k);
  if(send&&ws?.readyState===1)ws.send(JSON.stringify({type:"block",x,y,z,block:null}));
}
function generateWorld(){
  for(let x=-28;x<=28;x++)for(let z=-28;z<=28;z++){
    const h=terrainHeight(x,z);
    for(let y=0;y<=h;y++)addBlock(x,y,z,y===h?(h<2?"sand":"grass"):(y<h-2?"stone":"dirt"),false);
    if((Math.abs(x*13+z*7)%97)===0 && h>2) makeTree(x,h+1,z);
  }
}
function makeTree(x,y,z){
  for(let i=0;i<4;i++)addBlock(x,y+i,z,"wood",false);
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=2;dy<=4;dy++){
    if(Math.abs(dx)+Math.abs(dz)+(dy===4?1:0)<5 && !(dx===0&&dz===0&&dy<4))addBlock(x+dx,y+dy,z+dz,"leaves",false);
  }
}
function init3D(){
  scene=new THREE.Scene();scene.background=new THREE.Color(0x83bafa);scene.fog=new THREE.Fog(0x83bafa,35,95);
  camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,180);camera.position.set(0,8,8);
  renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;document.body.appendChild(renderer.domElement);
  controls=new PointerLockControls(camera,renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xd7eaff,0x65704c,2));
  const sun=new THREE.DirectionalLight(0xfff2d4,2.2);sun.position.set(-30,55,25);sun.castShadow=true;scene.add(sun);
  const water=new THREE.Mesh(new THREE.PlaneGeometry(180,180),new THREE.MeshLambertMaterial({color:0x236cc4,transparent:true,opacity:.86}));
  water.rotation.x=-Math.PI/2;water.position.y=1.1;scene.add(water);
  generateWorld();
  addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
  renderer.domElement.addEventListener("click",()=>{if(joined&&!inventory.classList.contains("hidden")===false&&!chatInput.matches(":focus"))controls.lock();});
  controls.addEventListener("lock",()=>{});
  controls.addEventListener("unlock",()=>{});
  renderer.domElement.addEventListener("touchstart",e=>{
    if(!joined || e.touches.length!==1)return;
    touchLook={x:e.touches[0].clientX,y:e.touches[0].clientY};
  },{passive:true});
  renderer.domElement.addEventListener("touchmove",e=>{
    if(!touchLook || !joined || e.touches.length!==1)return;
    const t=e.touches[0],dx=t.clientX-touchLook.x,dy=t.clientY-touchLook.y;
    const rot=new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");
    rot.y-=dx*.004;rot.x-=dy*.004;rot.x=Math.max(-1.45,Math.min(1.45,rot.x));
    camera.quaternion.setFromEuler(rot);touchLook={x:t.clientX,y:t.clientY};
  },{passive:true});
  renderer.domElement.addEventListener("touchend",()=>touchLook=null,{passive:true});
  animate();
}
function addRemote(p){
  if(p.id===myId)return;
  const group=new THREE.Group();
  const skin=new THREE.MeshLambertMaterial({color:0xc58b63}), shirt=new THREE.MeshLambertMaterial({color:p.color||0x2583b7}), pants=new THREE.MeshLambertMaterial({color:0x303c83});
  const body=new THREE.Mesh(new THREE.BoxGeometry(.55,.72,.3),shirt);body.position.y=1.05;group.add(body);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.42,.42,.42),skin);head.position.y=1.64;group.add(head);
  for(const x of [-.17,.17]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.2,.65,.22),pants);leg.position.set(x,.36,0);group.add(leg);}
  const label=document.createElement("canvas");label.width=256;label.height=64;const ctx=label.getContext("2d");ctx.font="bold 32px Arial";ctx.textAlign="center";ctx.fillStyle="white";ctx.strokeStyle="#222";ctx.lineWidth=5;ctx.strokeText(p.name||"Player",128,42);ctx.fillText(p.name||"Player",128,42);
  const tex=new THREE.CanvasTexture(label),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true}));sprite.scale.set(2,0.5,1);sprite.position.y=2.25;group.add(sprite);
  group.position.set(p.x,p.y,p.z);scene.add(group);remote.set(p.id,group);
}
function updateRemote(p){let g=remote.get(p.id);if(!g){addRemote(p);g=remote.get(p.id);}if(g){g.position.set(p.x,p.y,p.z);g.rotation.y=p.yaw||0;}}
function removeRemote(id){const g=remote.get(id);if(g){scene.remove(g);remote.delete(id);}}
function connect(){
  const proto=location.protocol==="https:"?"wss":"ws";
  ws=new WebSocket(`${proto}://${location.host}`);
  ws.onopen=()=>{ws.send(JSON.stringify({type:"hello",name:$("#nickname").value||"Player"}));$("#worldStatus").textContent="● 서버 연결됨";};
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.type==="welcome"){myId=m.id;for(const p of m.players)addRemote(p);for(const b of m.blocks)addBlock(b.x,b.y,b.z,b.block,false);$("#online").textContent=`온라인 ${m.players.length}명`;}
    if(m.type==="player-joined"){addRemote(m.player);$("#online").textContent=`온라인 ${remote.size+1}명`;}
    if(m.type==="player-moved")updateRemote(m.player);
    if(m.type==="player-name"){const g=remote.get(m.id);if(g){removeRemote(m.id);addRemote({id:m.id,x:g.position.x,y:g.position.y,z:g.position.z,name:m.name});}}
    if(m.type==="player-left"){removeRemote(m.id);$("#online").textContent=`온라인 ${remote.size+1}명`;}
    if(m.type==="block"){if(m.block===null)removeBlock(m.x,m.y,m.z,false);else addBlock(m.x,m.y,m.z,m.block,false);}
    if(m.type==="chat")addChat(`${m.name}: ${m.text}`);
  };
  ws.onclose=()=>{$("#worldStatus").textContent="서버 연결 끊김 · 새로고침으로 재접속";};
}
function addChat(t){const d=document.createElement("div");d.textContent=t;$("#messages").append(d);while($("#messages").children.length>6)$("#messages").firstChild.remove();}
function targetBlock(){
  raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
  const hits=raycaster.intersectObjects([...blockMeshes.values()],false);
  return hits.length&&hits[0].distance<6?hits[0]:null;
}
function editBlock(place){
  const hit=targetBlock();if(!hit)return;
  const b=hit.object.userData;
  if(!place){if(b.y<=0)return;removeBlock(b.x,b.y,b.z);inventoryItems[b.type]=(inventoryItems[b.type]||0)+1;}
  else{
    const type=slots[selected];if((inventoryItems[type]||0)<=0)return;
    const n=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const x=Math.floor(b.x+n.x*.51),y=Math.floor(b.y+n.y*.51),z=Math.floor(b.z+n.z*.51);
    const px=Math.floor(camera.position.x),pz=Math.floor(camera.position.z);
    if(x===px&&z===pz&&y>=Math.floor(camera.position.y-1.7)&&y<=Math.floor(camera.position.y))return;
    addBlock(x,y,z,type);inventoryItems[type]--;
  }
  updateHotbar();
}
function updateHotbar(){
  $("#hotbar").innerHTML=slots.map((t,i)=>`<div class="slot ${i===selected?"active":""}" data-slot="${i}">${emojis[t]||"▪"}<small>${inventoryItems[t]||0}</small></div>`).join("");
}
function updateInventory(){
  $("#invgrid").innerHTML=Object.entries(inventoryItems).map(([t,n])=>`<div class="invslot">${emojis[t]||"▪"}<small>${n}</small></div>`).join("");
}
function animate(){
  requestAnimationFrame(animate);
  if(joined&&controls.isLocked){
    const dir=new THREE.Vector3();const forward=new THREE.Vector3();camera.getWorldDirection(forward);forward.y=0;forward.normalize();
    const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
    const speed=5.5*(keys.ShiftLeft?1.45:1);
    if(keys.KeyW)dir.add(forward);if(keys.KeyS)dir.sub(forward);if(keys.KeyD)dir.add(right);if(keys.KeyA)dir.sub(right);
    if(dir.lengthSq())dir.normalize().multiplyScalar(speed*.016);
    const nx=camera.position.x+dir.x,nz=camera.position.z+dir.z;
    const ground=terrainHeight(Math.round(nx),Math.round(nz))+1.65;
    if(!isBlocked(nx,camera.position.y,nz))camera.position.x=nx;
    if(!isBlocked(camera.position.x,camera.position.y,nz))camera.position.z=nz;
    velocityY-=.022;camera.position.y+=velocityY;
    if(camera.position.y<ground){camera.position.y=ground;velocityY=0;onGround=true;}else onGround=false;
    if(keys.Space&&onGround){velocityY=.28;onGround=false;}
    const now=performance.now();if(now-lastMove>65&&ws?.readyState===1){lastMove=now;const e=new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");ws.send(JSON.stringify({type:"move",x:camera.position.x,y:camera.position.y-1.65,z:camera.position.z,yaw:e.y}));}
  }
  renderer.render(scene,camera);
}
function isBlocked(x,y,z){const bx=Math.floor(x),bz=Math.floor(z);for(let yy=Math.floor(y-1.6);yy<=Math.floor(y-.1);yy++)if(world.has(key(bx,yy,bz)))return true;return false;}

$("#play").onclick=()=>{init3D();connect();joined=true;menu.classList.add("hidden");if(matchMedia("(pointer:fine)").matches)controls.lock();updateHotbar();};
document.addEventListener("keydown",e=>{
  if(e.code==="Enter"){if(chatInput.style.display==="block"){const text=chatInput.value.trim();if(text&&ws?.readyState===1)ws.send(JSON.stringify({type:"chat",text}));chatInput.value="";chatInput.style.display="none";chatInput.blur();}else{controls.unlock();chatInput.style.display="block";chatInput.focus();}return;}
  keys[e.code]=true;
  if(e.code==="KeyE"){inventory.classList.toggle("hidden");if(!inventory.classList.contains("hidden")){controls.unlock();updateInventory();}else if(matchMedia("(pointer:fine)").matches)controls.lock();}
  if(e.code.startsWith("Digit")){selected=Math.max(0,Math.min(8,Number(e.code.slice(5))-1));updateHotbar();}
});
document.addEventListener("keyup",e=>keys[e.code]=false);
document.addEventListener("mousedown",e=>{if(!joined||!controls.isLocked)return;if(e.button===0)editBlock(false);if(e.button===2)editBlock(true);});
document.addEventListener("contextmenu",e=>e.preventDefault());
$("#closeInv").onclick=()=>inventory.classList.add("hidden");
document.querySelectorAll("[data-key]").forEach(b=>{
  const code=b.dataset.key;b.addEventListener("touchstart",e=>{e.preventDefault();keys[code]=true;},{passive:false});b.addEventListener("touchend",()=>keys[code]=false);
});
$("#jumpBtn").addEventListener("touchstart",e=>{e.preventDefault();if(onGround)velocityY=.28;},{passive:false});
$("#breakBtn").addEventListener("touchstart",e=>{e.preventDefault();editBlock(false);},{passive:false});
$("#placeBtn").addEventListener("touchstart",e=>{e.preventDefault();editBlock(true);},{passive:false});
$("#hotbar").addEventListener("click",e=>{const s=e.target.closest("[data-slot]");if(s){selected=Number(s.dataset.slot);updateHotbar();}});
