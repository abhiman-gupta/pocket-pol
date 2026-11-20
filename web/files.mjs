const crcTable = Uint32Array.from({length:256},(_,n) => {
  for (let bit=0; bit<8; bit++) n = (n>>>1)^((n&1) ? 0xedb88320 : 0);
  return n>>>0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc>>>8)^crcTable[(crc^byte)&255];
  return (crc^0xffffffff)>>>0;
}

// Store the raw channel data and its sidecar in a single browser download.
export function zipFiles(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [name,content] of files) {
    const filename = encoder.encode(name);
    const bytes = new Uint8Array(content);
    const local = new DataView(new ArrayBuffer(30+filename.length));
    const entry = new DataView(new ArrayBuffer(46+filename.length));
    const crc = crc32(bytes);
    local.setUint32(0,0x04034b50,true);
    local.setUint16(4,20,true);
    local.setUint16(12,33,true);
    local.setUint32(14,crc,true);
    local.setUint32(18,bytes.length,true);
    local.setUint32(22,bytes.length,true);
    local.setUint16(26,filename.length,true);
    new Uint8Array(local.buffer).set(filename,30);
    entry.setUint32(0,0x02014b50,true);
    entry.setUint16(4,20,true);
    entry.setUint16(6,20,true);
    entry.setUint16(14,33,true);
    entry.setUint32(16,crc,true);
    entry.setUint32(20,bytes.length,true);
    entry.setUint32(24,bytes.length,true);
    entry.setUint16(28,filename.length,true);
    entry.setUint32(42,offset,true);
    new Uint8Array(entry.buffer).set(filename,46);
    parts.push(local.buffer,bytes);
    directory.push(entry.buffer);
    offset += local.byteLength+bytes.length;
    directorySize += entry.byteLength;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);
  end.setUint16(8,files.length,true);
  end.setUint16(10,files.length,true);
  end.setUint32(12,directorySize,true);
  end.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end.buffer],{type:"application/zip"});
}
