const JSZip=require('jszip'); const fs=require('fs');
const EMU=914400;
(async()=>{
  const zip=await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a,b)=>(+a.match(/\d+/))-(+b.match(/\d+/)));
  for(const n of names){
    const num=+n.match(/\d+/);
    const xml=await zip.file(n).async('string');
    const rels=await zip.file(`ppt/slides/_rels/slide${num}.xml.rels`).async('string');
    const map={}; for(const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) map[m[1]]=m[2];
    const pics=[...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
    if(!pics.length) continue;
    console.log(`\nslide ${num}  (${pics.length} picture${pics.length>1?'s':''})`);
    pics.forEach((p,i)=>{
      const s=p[0];
      const emb=(s.match(/r:embed="([^"]+)"/)||[])[1];
      const nm=(s.match(/name="([^"]*)"/)||[])[1];
      const off=s.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
      const ext=s.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
      const crop=/srcRect/.test(s)?' cropped':'';
      const box = off&&ext ? `x=${(off[1]/EMU).toFixed(2)}" y=${(off[2]/EMU).toFixed(2)}" w=${(ext[1]/EMU).toFixed(2)}" h=${(ext[2]/EMU).toFixed(2)}" ratio=${(ext[1]/ext[2]).toFixed(2)}` : 'in a group/placeholder';
      console.log(`   [${i}] ${String(nm).slice(0,28).padEnd(28)} ${box}${crop}  -> ${map[emb]}`);
    });
  }
})();
