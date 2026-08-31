const CLIENT_ID = "e4d1519af9694cc89525dcb33bc93ccf";
const SCOPES = "playlist-modify-public playlist-modify-private";
const API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const $ = id => document.getElementById(id);
let stopRequested = false;

function redirectUri(){ return location.origin + location.pathname; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function log(msg){ $("log").textContent += `\n${new Date().toLocaleTimeString()}  ${msg}`; $("log").scrollTop=$("log").scrollHeight; }
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}
function b64url(bytes){ return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function randomString(n=64){ return b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0,n); }
async function challenge(verifier){ return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)))); }
function token(){ return JSON.parse(localStorage.getItem("spotify_tokens")||"null"); }
function saveToken(data){ const old=token()||{}; localStorage.setItem("spotify_tokens",JSON.stringify({...old,...data,expires_at:Date.now()+(data.expires_in||3600)*1000})); }

async function login(){
  const verifier=randomString(); localStorage.setItem("pkce_verifier",verifier);
  const state=randomString(24); sessionStorage.setItem("oauth_state",state);
  const u=new URL("https://accounts.spotify.com/authorize");
  u.search=new URLSearchParams({client_id:CLIENT_ID,response_type:"code",redirect_uri:redirectUri(),scope:SCOPES,code_challenge_method:"S256",code_challenge:await challenge(verifier),state}).toString();
  location.assign(u);
}
async function exchangeCode(code){
  const verifier=localStorage.getItem("pkce_verifier"); if(!verifier) throw new Error("PKCE-verifier ontbreekt. Start de login opnieuw.");
  const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:CLIENT_ID,grant_type:"authorization_code",code,redirect_uri:redirectUri(),code_verifier:verifier})});
  const d=await r.json(); if(!r.ok) throw new Error(d.error_description||d.error||"Tokenuitwisseling mislukt"); saveToken(d); localStorage.removeItem("pkce_verifier");
}
async function accessToken(){
  let t=token(); if(!t) throw new Error("Log eerst in met Spotify.");
  if(Date.now()<t.expires_at-60000) return t.access_token;
  if(!t.refresh_token) throw new Error("Sessie verlopen. Log opnieuw in.");
  const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:CLIENT_ID,grant_type:"refresh_token",refresh_token:t.refresh_token})});
  const d=await r.json(); if(!r.ok) throw new Error(d.error_description||"Vernieuwen van token mislukt"); saveToken(d); return d.access_token;
}
async function api(path,options={},retry=0){
  const r=await fetch(API+path,{...options,headers:{Authorization:`Bearer ${await accessToken()}`,"Content-Type":"application/json",...(options.headers||{})}});
  if(r.status===401 && retry<1){ const t=token(); if(t) t.expires_at=0,localStorage.setItem("spotify_tokens",JSON.stringify(t)); return api(path,options,retry+1); }
  if(r.status===429){
    let body={}; try{body=await r.clone().json()}catch{}
    const reason=body?.error?.reason||""; if(reason==="QUOTA_EXCEEDED") throw new Error("Spotify-ontwikkelaarsquota bereikt (QUOTA_EXCEEDED). Dit is geen gewone korte rate-limit.");
    if(retry>=3) throw new Error("Spotify blijft requests beperken (429). Stop en probeer later opnieuw.");
    const wait=Math.max(1,Number(r.headers.get("Retry-After")||5)); log(`Rate-limit: nieuwe poging na ${wait} s.`); await sleep(wait*1000); return api(path,options,retry+1);
  }
  const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok){ const e=new Error(data?.error?.message||data?.error_description||`Spotify-fout ${r.status}`); e.status=r.status; throw e; }
  return data;
}
function normalizeArtistName(name){
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|official|music|band)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a,b){
  const rows=a.length+1;
  const cols=b.length+1;
  const matrix=Array.from({length:rows},()=>Array(cols).fill(0));

  for(let i=0;i<rows;i++) matrix[i][0]=i;
  for(let j=0;j<cols;j++) matrix[0][j]=j;

  for(let i=1;i<rows;i++){
    for(let j=1;j<cols;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      matrix[i][j]=Math.min(
        matrix[i-1][j]+1,
        matrix[i][j-1]+1,
        matrix[i-1][j-1]+cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function artistNameSimilarity(inputName,resultName){
  const a=normalizeArtistName(inputName);
  const b=normalizeArtistName(resultName);
  if(!a || !b) return 0;
  if(a===b) return 1;

  const distance=levenshteinDistance(a,b);
  const characterScore=1-distance/Math.max(a.length,b.length);

  const wordsA=new Set(a.split(" ").filter(Boolean));
  const wordsB=new Set(b.split(" ").filter(Boolean));
  const intersection=[...wordsA].filter(word=>wordsB.has(word)).length;
  const union=new Set([...wordsA,...wordsB]).size;
  const wordScore=union?intersection/union:0;

  return Math.max(characterScore,wordScore);
}

async function exactArtist(name){
  const d=await api(`/search?${new URLSearchParams({q:name,type:"artist",limit:"10"})}`);
  const items=d.artists?.items||[];

  const ranked=items
    .map(artist=>({
      artist,
      similarity:artistNameSimilarity(name,artist.name)
    }))
    .sort((a,b)=>b.similarity-a.similarity);

  const best=ranked[0];
  if(!best || best.similarity<0.80){
    if(best){
      log(`Overgeslagen: "${name}" leek slechts ${Math.round(best.similarity*100)}% op Spotify-artiest "${best.artist.name}".`);
    }
    return null;
  }

  if(best.similarity<1){
    log(`Artiestmatch: "${name}" -> "${best.artist.name}" (${Math.round(best.similarity*100)}%).`);
  }
  return best.artist;
}
async function tracksFor(artist,count,market,usedUris){
const selected=[];
const seenHere=new Set();

function normalizeTrackName(name){
  return name
    .toLowerCase()
    .replace(/\s*\(.*?(remaster|remastered|deluxe|single version|album version).*?\)/gi, "")
    .replace(/\s*-\s*(remaster|remastered|deluxe|single version|album version).*$/gi, "")
    .trim();
}
  let usedOfficial=false;

function addCandidates(tracks){
  for(const track of tracks || []){

    if(selected.length >= count) break;

    const isrc = track.external_ids?.isrc || "";
    const normalizedName = normalizeTrackName(track.name);

    const isrcKey = isrc
      ? artist.id + "|isrc|" + isrc
      : null;

    const nameKey =
      artist.id + "|name|" + normalizedName;

    if(
      !track?.uri ||
      (isrcKey && seenHere.has(isrcKey)) ||
      seenHere.has(nameKey)
    ){
      continue;
    }

    if(isrcKey) seenHere.add(isrcKey);
    seenHere.add(nameKey);

    selected.push(track);
  }
}


  try{
    const d=await api(`/artists/${encodeURIComponent(artist.id)}/top-tracks?market=${encodeURIComponent(market)}`);
    if(d.tracks?.length){
      usedOfficial=true;
      addCandidates(d.tracks);
    }
}catch(e){
  if(String(e.message).includes("QUOTA_EXCEEDED")){
    throw e;
  }

  if(![403,404].includes(e.status)){
    log(
      `Toptracks voor ${artist.name}: ${e.message}. ` +
      `Zoekfallback wordt gebruikt.`
    );
  }
}
  if(selected.length<count){
    const q=`artist:\"${artist.name.replaceAll('"','')}\"`;
    for(let offset=0;selected.length<count && offset<=100;offset+=10){
      const d=await api(`/search?${new URLSearchParams({q,type:"track",market,limit:"10",offset:String(offset)})}`);
      const batch=(d.tracks?.items||[]).filter(t=>t.artists?.some(a=>a.id===artist.id));
      addCandidates(batch);
      if(!d.tracks?.next) break;
    }
  }

  const method=usedOfficial
    ? (selected.length<count ? "officiële toptracks + Spotify-zoekrangschikking" : "officiële toptracks")
    : "Spotify-zoekrangschikking (benadering)";
  return {tracks:selected,method};
}
function addRow(input,artist,tracks,method,status){ const tr=document.createElement("tr"); tr.innerHTML=`<td>${esc(input)}</td><td>${esc(artist?.name||"-")}</td><td>${tracks.map(t=>`<a target="_blank" rel="noopener" href="${esc(t.external_urls?.spotify||'#')}">${esc(t.name)}</a>`).join("<br>")||"-"}</td><td>${esc(method||"-")}</td><td>${esc(status)}</td>`; $("results").appendChild(tr); }
async function createPlaylist(){
  stopRequested = false;
  let quotaReached = false;

  $("results").innerHTML = "";
  $("playlistLink").innerHTML = "";
  $("log").textContent = "Start...";

  const names = $("artists").value
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  if(!names.length){
    log("Geen artiesten ingevuld.");
    return;
  }

  const count = Math.max(
    1,
    Math.min(10, Number($("tracksPerArtist").value) || 1)
  );

  const market = ($("market").value || "BE")
    .trim()
    .toUpperCase();

  const uris = [];

  $("createBtn").disabled = true;

  try{
    await accessToken();

    for(let i = 0; i < names.length; i++){
      if(stopRequested){
        throw new Error("Verwerking gestopt door gebruiker.");
      }

      $("progress").value = Math.round(i / names.length * 80);

      const name = names[i];
      log(`Zoeken: ${name}`);

      try{
        const artist = await exactArtist(name);

        if(!artist){
          addRow(
            name,
            null,
            [],
            "",
            "Artiest niet gevonden"
          );
          continue;
        }

        const result = await tracksFor(
          artist,
          count,
          market
        );

        result.tracks.forEach(track => {
          if(track?.uri && !uris.includes(track.uri)){
            uris.push(track.uri);
          }
        });

        const status =
          result.tracks.length === count
            ? "OK"
            : `${result.tracks.length}/${count} unieke tracks gevonden`;

        addRow(
          name,
          artist,
          result.tracks,
          result.method,
          status
        );

      }catch(e){
        addRow(name, null, [], "", e.message);
        log(`${name}: ${e.message}`);

        if(String(e.message).includes("QUOTA_EXCEEDED")){
          quotaReached = true;

          log(
            "Spotify-ontwikkelaarsquota bereikt. " +
            "Het zoeken wordt gestopt en er wordt geprobeerd " +
            "een playlist te maken met de reeds gevonden tracks."
          );

          break;
        }
      }

      await sleep(
        Math.max(0, Number($("delayMs").value) || 0)
      );
    }

    if(!uris.length){
      throw new Error(
        "Geen passende tracks gevonden. Er is geen playlist aangemaakt."
      );
    }

    log(`Playlist aanmaken met ${uris.length} gevonden tracks...`);

    const p = await api("/me/playlists", {
      method: "POST",
      body: JSON.stringify({
        name:
          $("playlistName").value.trim() ||
          "Artiestenplaylist",
        public: $("isPublic").checked,
        description:
          quotaReached
            ? "Gedeeltelijke playlist wegens Spotify-quotabeperking"
            : "Gemaakt met Spotify Artiesten naar Playlist"
      })
    });

    let addedTrackCount = 0;

    for(let i = 0; i < uris.length; i += 100){
      const batch = uris.slice(i, i + 100);

      try{
        await api(`/playlists/${p.id}/items`, {
          method: "POST",
          body: JSON.stringify({
            uris: batch
          })
        });

        addedTrackCount += batch.length;

      }catch(e){
        if(String(e.message).includes("QUOTA_EXCEEDED")){
          quotaReached = true;

          log(
            "Spotify-ontwikkelaarsquota bereikt tijdens " +
            "het toevoegen van tracks. De playlist bevat mogelijk " +
            "slechts een deel van de gevonden tracks."
          );

          break;
        }

        throw e;
      }
    }

    $("progress").value = 100;

    $("playlistLink").innerHTML =
      `Klaar: <a target="_blank" rel="noopener" ` +
      `href="${esc(p.external_urls.spotify)}">` +
      `open de playlist in Spotify</a>`;

    if(quotaReached){
      log(
        `Gedeeltelijke playlist aangemaakt. ` +
        `${addedTrackCount} tracks toegevoegd voordat het quota werd bereikt.`
      );
    }else{
      log(`${addedTrackCount} tracks toegevoegd.`);
    }

  }catch(e){
    log(`Gestopt: ${e.message}`);
  }finally{
    $("createBtn").disabled = false;
  }
}
async function init(){
  $("clientIdView").textContent=CLIENT_ID; $("redirectUri").textContent=redirectUri();
  const q=new URLSearchParams(location.search); if(q.get("error")) log(`Spotify-login geweigerd: ${q.get("error")}`);
  if(q.get("code")){
    try{ const expected=sessionStorage.getItem("oauth_state"); if(expected&&q.get("state")!==expected) throw new Error("Ongeldige OAuth-state."); await exchangeCode(q.get("code")); history.replaceState({},"",redirectUri()); }
    catch(e){log(e.message)}
  }
  try{ const me=await api("/me"); $("authStatus").textContent=`Verbonden als ${me.display_name||me.id}.`; }catch{$("authStatus").textContent="Niet verbonden."}
}
$("loginBtn").onclick=login; $("logoutBtn").onclick=()=>{localStorage.removeItem("spotify_tokens");location.reload()}; $("copyRedirect").onclick=()=>navigator.clipboard.writeText(redirectUri()); $("createBtn").onclick=createPlaylist; $("stopBtn").onclick=()=>{stopRequested=true;log("Stop aangevraagd...")}; init();
