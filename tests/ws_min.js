// ~60 line WebSocket client (text frames only) so no npm dependency is needed.
const net = require('net'); const crypto = require('crypto');
module.exports = class WS {
  constructor(url){
    const u = new URL(url);
    this.buf = Buffer.alloc(0); this.handlers=[]; this.waiters=[];
    this.ready = new Promise((res,rej)=>{
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = net.connect(u.port, u.hostname, ()=>{
        this.sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      this.sock.on('error', rej);
      this.sock.on('data', d => this.onData(d, res));
    });
  }
  onData(d,res){
    this.buf = Buffer.concat([this.buf,d]);
    if(!this.up){ const i=this.buf.indexOf('\r\n\r\n'); if(i<0) return; this.up=true; res(); this.buf=this.buf.slice(i+4); }
    for(;;){
      if(this.buf.length<2) return;
      const len0 = this.buf[1]&127; let off=2, len=len0;
      if(len0===126){ if(this.buf.length<4) return; len=this.buf.readUInt16BE(2); off=4; }
      else if(len0===127){ if(this.buf.length<10) return; len=Number(this.buf.readBigUInt64BE(2)); off=10; }
      if(this.buf.length<off+len) return;
      const payload=this.buf.slice(off,off+len).toString('utf8');
      this.buf=this.buf.slice(off+len);
      if(this.onmessage) this.onmessage(payload);
    }
  }
  send(str){
    const data=Buffer.from(str,'utf8'); const mask=crypto.randomBytes(4);
    let header;
    if(data.length<126){ header=Buffer.from([0x81,0x80|data.length]); }
    else if(data.length<65536){ header=Buffer.alloc(4); header[0]=0x81; header[1]=0x80|126; header.writeUInt16BE(data.length,2); }
    else { header=Buffer.alloc(10); header[0]=0x81; header[1]=0x80|127; header.writeBigUInt64BE(BigInt(data.length),2); }
    const masked=Buffer.alloc(data.length);
    for(let i=0;i<data.length;i++) masked[i]=data[i]^mask[i%4];
    this.sock.write(Buffer.concat([header,mask,masked]));
  }
  close(){ try{this.sock.destroy();}catch(e){} }
};
