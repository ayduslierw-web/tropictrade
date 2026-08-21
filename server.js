require("dotenv").config();
const express=require("express");
const session=require("express-session");
const axios=require("axios");
const path=require("path");

const app=express();
const PORT=process.env.PORT||3000;
const BASE_URL=(process.env.BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,"");
const API_KEY=process.env.STEAM_API_KEY||"";

app.use(session({
  secret:process.env.SESSION_SECRET||"replace-me",
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:7*24*60*60*1000}
}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/auth/steam",(req,res)=>{
  const q=new URLSearchParams({
    "openid.ns":"http://specs.openid.net/auth/2.0",
    "openid.mode":"checkid_setup",
    "openid.return_to":`${BASE_URL}/auth/steam/return`,
    "openid.realm":BASE_URL,
    "openid.identity":"http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id":"http://specs.openid.net/auth/2.0/identifier_select"
  });
  res.redirect("https://steamcommunity.com/openid/login?"+q);
});

app.get("/auth/steam/return",async(req,res)=>{
  try{
    const claimed=String(req.query["openid.claimed_id"]||"");
    const m=claimed.match(/\/(\d{17})\/?$/);
    if(!m) return res.status(400).send("Не удалось получить SteamID64.");
    const form=new URLSearchParams();
    for(const [k,v] of Object.entries(req.query)) form.set(k,String(v));
    form.set("openid.mode","check_authentication");
    const check=await axios.post("https://steamcommunity.com/openid/login",form.toString(),{
      headers:{"Content-Type":"application/x-www-form-urlencoded"}
    });
    if(!String(check.data).includes("is_valid:true")) return res.status(401).send("Steam не подтвердил авторизацию.");
    req.session.steamId=m[1];
    res.redirect("/#profile");
  }catch(e){console.error(e.message);res.status(500).send("Ошибка Steam авторизации.");}
});

app.get("/auth/logout",(req,res)=>req.session.destroy(()=>res.redirect("/#profile")));

app.get("/api/me",async(req,res)=>{
  if(!req.session.steamId) return res.json({authenticated:false});
  let profile=null;
  if(API_KEY){
    try{
      const r=await axios.get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",{
        params:{key:API_KEY,steamids:req.session.steamId}
      });
      profile=r.data.response.players?.[0]||null;
    }catch(e){console.error(e.message);}
  }
  res.json({authenticated:true,steamId:req.session.steamId,profile});
});

app.get("/api/inventory",async(req,res)=>{
  if(!req.session.steamId)return res.status(401).json({error:"not_logged_in"});
  if(!API_KEY)return res.status(503).json({error:"api_key_missing"});
  try{
    const r=await axios.get("https://partner.steam-api.com/IInventoryService/GetInventory/v1/",{
      params:{key:API_KEY,appid:730,steamid:req.session.steamId}
    });
    res.json(r.data.response||{});
  }catch(e){
    console.error(e.response?.data||e.message);
    res.status(502).json({error:"inventory_unavailable"});
  }
});

app.get("/*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`TropicTrade: ${BASE_URL}`));
