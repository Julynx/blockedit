const fs = require("fs");

const png = fs.readFileSync(`${__dirname}/../assets/logo.png`);
const isPng = png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
if (!isPng) {
  throw new Error("logo.png is not a valid PNG");
}

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== height) {
  throw new Error("logo.png must be square for use as a Windows application icon");
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry[0] = width >= 256 ? 0 : width;
entry[1] = height >= 256 ? 0 : height;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

fs.writeFileSync(`${__dirname}/../assets/app-icon.ico`, Buffer.concat([header, entry, png]));
