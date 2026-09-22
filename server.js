const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_FILE = path.join(__dirname,'data','db.json');
const sessions = new Set();
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
function db(){return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))} function save(d){const t=DATA_FILE+'.tmp';fs.writeFileSync(t,JSON.stringify(d,null,2));fs.renameSync(t,DATA_FILE)}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function json(res,status,data){const out=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(out)});res.end(out)}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>100000)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function token(req){return (req.headers.authorization||'').replace(/^Bearer\s+/i,'')}
function auth(req,res){if(!sessions.has(token(req))){json(res,401,{error:'Unauthorized'});return false}return true}
function redirect(res,to){res.writeHead(302,{Location:to});res.end()}
function staticFile(req,res){let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p==='/')p='/index.html';if(p==='/admin')p='/admin.html';const root=path.join(__dirname,'public');const file=path.normalize(path.join(root,p));if(!file.startsWith(root))return json(res,403,{error:'Forbidden'});fs.readFile(file,(e,data)=>{if(e)return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(data)})}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,service:'Wari Sahyadrichi backend'});
    if(req.method==='GET'&&u.pathname==='/api/treks')return json(res,200,db().treks);
    if(req.method==='POST'&&u.pathname==='/api/bookings'){
      const b=await body(req);const name=clean(b.name,100),mobile=clean(b.mobile,10),email=clean(b.email,150),date=clean(b.date,20),trek=clean(b.trek,100),pickup=clean(b.pickup,100),participants=Number(b.participants),emergency=clean(b.emergency,10),message=clean(b.message,1000);
      if(!name||!/^[0-9]{10}$/.test(mobile)||!date||!trek||!Number.isInteger(participants)||participants<1||participants>20)return json(res,400,{error:'Please provide valid required booking details.'});
      const d=db();const selected=d.treks.find(t=>trek.toLowerCase().startsWith(t.name.toLowerCase()));if(!selected)return json(res,400,{error:'Selected trek is not available.'});
      if(selected.status!=='active')return json(res,400,{error:'This trek is currently coming soon.'});
      const capacity=Number(selected.totalSeats)||0;
      const used=d.bookings.filter(x=>x.trekId===selected.id&&x.date===date&&x.status!=='Cancelled').reduce((sum,x)=>sum+(Number(x.participants)||0),0);
      if(capacity>0 && used+participants>capacity)return json(res,400,{error:`Only ${Math.max(0,capacity-used)} seat(s) are available for this trek on ${date}.`});
      const booking={id:'WS-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),createdAt:new Date().toISOString(),name,mobile,email,date,trek,trekId:selected.id,pickup,participants,emergency,message,status:'Pending'};d.bookings.unshift(booking);save(d);return json(res,201,{message:'Booking saved successfully',booking,availableSeats:capacity?capacity-used-participants:null});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/login'){const b=await body(req);if(clean(b.username,100)!==ADMIN_USERNAME||String(b.password||'')!==ADMIN_PASSWORD)return json(res,401,{error:'Invalid username or password'});const t=crypto.randomBytes(32).toString('hex');sessions.add(t);return json(res,200,{token:t})}
    if(u.pathname.startsWith('/api/admin/')){
      if(!auth(req,res))return;
      if(req.method==='POST'&&u.pathname==='/api/admin/logout'){sessions.delete(token(req));return json(res,200,{ok:true})}
      if(req.method==='GET'&&u.pathname==='/api/admin/bookings')return json(res,200,db().bookings);
      const bm=u.pathname.match(/^\/api\/admin\/bookings\/([^/]+)$/); if(bm&&req.method==='PATCH'){const b=await body(req),d=db(),x=d.bookings.find(v=>v.id===decodeURIComponent(bm[1]));if(!x)return json(res,404,{error:'Booking not found'});if(!['Pending','Confirmed','Cancelled'].includes(b.status))return json(res,400,{error:'Invalid status'});x.status=b.status;x.updatedAt=new Date().toISOString();save(d);return json(res,200,x)}
      if(req.method==='POST'&&u.pathname==='/api/admin/treks'){const b=await body(req),d=db(),name=clean(b.name,100),id=clean(b.id,80);if(!name||!id)return json(res,400,{error:'Name and id are required'});if(d.treks.some(t=>t.id===id))return json(res,409,{error:'Trek id already exists'});const t={id,name,price:Math.max(0,Number(b.price)||0),totalSeats:Math.max(0,Number(b.totalSeats)||0),status:b.status==='coming-soon'?'coming-soon':'active',route:clean(b.route,150),difficulty:clean(b.difficulty,50),duration:clean(b.duration,50),subtitle:clean(b.subtitle,250),description:clean(b.description,1000),image:clean(b.image,250)};d.treks.push(t);save(d);return json(res,201,t)}
      const tm=u.pathname.match(/^\/api\/admin\/treks\/([^/]+)$/); if(tm&&req.method==='PATCH'){const b=await body(req),d=db(),t=d.treks.find(v=>v.id===decodeURIComponent(tm[1]));if(!t)return json(res,404,{error:'Trek not found'});['name','route','difficulty','duration','subtitle','description','image'].forEach(k=>{if(b[k]!==undefined)t[k]=clean(b[k],k==='description'?1000:(k==='subtitle'?250:250))});if(b.price!==undefined)t.price=Math.max(0,Number(b.price)||0);if(b.totalSeats!==undefined)t.totalSeats=Math.max(0,Number(b.totalSeats)||0);if(b.status!==undefined)t.status=b.status==='coming-soon'?'coming-soon':'active';save(d);return json(res,200,t)}
      if(tm&&req.method==='DELETE'){const d=db(),n=d.treks.length;d.treks=d.treks.filter(t=>t.id!==decodeURIComponent(tm[1]));if(d.treks.length===n)return json(res,404,{error:'Trek not found'});save(d);return json(res,200,{ok:true})}
      return json(res,404,{error:'Admin route not found'});
    }
    if(req.method==='GET')return staticFile(req,res); return json(res,404,{error:'Not found'});
  }catch(e){console.error(e);return json(res,500,{error:'Server error'})}
});
server.listen(PORT,()=>console.log(`Wari Sahyadrichi backend running at http://localhost:${PORT}`));
