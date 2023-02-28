const JPG = (() => {
	/* -*- tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
	/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
	/*
	   Copyright 2011 notmasteryet

	   Licensed under the Apache License, Version 2.0 (the "License");
	   you may not use this file except in compliance with the License.
	   You may obtain a copy of the License at

		   http://www.apache.org/licenses/LICENSE-2.0

	   Unless required by applicable law or agreed to in writing, software
	   distributed under the License is distributed on an "AS IS" BASIS,
	   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	   See the License for the specific language governing permissions and
	   limitations under the License.
	*/

	// - The JPEG specification can be found in the ITU CCITT Recommendation T.81
	//   (www.w3.org/Graphics/JPEG/itu-t81.pdf)
	// - The JFIF specification can be found in the JPEG File Interchange Format
	//   (www.w3.org/Graphics/JPEG/jfif3.pdf)
	// - The Adobe Application-Specific JPEG markers in the Supporting the DCT Filters
	//   in PostScript Level 2, Technical Note #5116
	//   (partners.adobe.com/public/developer/en/ps/sdk/5116.DCT_Filter.pdf)

	var JpegImage = (function jpegImage() {
		"use strict";
		var dctZigZag = new Int32Array([
			0,
			1, 8,
			16, 9, 2,
			3, 10, 17, 24,
			32, 25, 18, 11, 4,
			5, 12, 19, 26, 33, 40,
			48, 41, 34, 27, 20, 13, 6,
			7, 14, 21, 28, 35, 42, 49, 56,
			57, 50, 43, 36, 29, 22, 15,
			23, 30, 37, 44, 51, 58,
			59, 52, 45, 38, 31,
			39, 46, 53, 60,
			61, 54, 47,
			55, 62,
			63
		]);

		var dctCos1 = 4017   // cos(pi/16)
		var dctSin1 = 799   // sin(pi/16)
		var dctCos3 = 3406   // cos(3*pi/16)
		var dctSin3 = 2276   // sin(3*pi/16)
		var dctCos6 = 1567   // cos(6*pi/16)
		var dctSin6 = 3784   // sin(6*pi/16)
		var dctSqrt2 = 5793   // sqrt(2)
		var dctSqrt1d2 = 2896  // sqrt(2) / 2

		function constructor() {
		}

		function buildHuffmanTable(codeLengths, values) {
			var k = 0, code = [], i, j, length = 16;
			while (length > 0 && !codeLengths[length - 1])
				length--;
			code.push({ children: [], index: 0 });
			var p = code[0], q;
			for (i = 0; i < length; i++) {
				for (j = 0; j < codeLengths[i]; j++) {
					p = code.pop();
					p.children[p.index] = values[k];
					while (p.index > 0) {
						if (code.length === 0)
							throw new Error('Could not recreate Huffman Table');
						p = code.pop();
					}
					p.index++;
					code.push(p);
					while (code.length <= i) {
						code.push(q = { children: [], index: 0 });
						p.children[p.index] = q.children;
						p = q;
					}
					k++;
				}
				if (i + 1 < length) {
					// p here points to last code
					code.push(q = { children: [], index: 0 });
					p.children[p.index] = q.children;
					p = q;
				}
			}
			return code[0].children;
		}

		function decodeScan(data, offset,
			frame, components, resetInterval,
			spectralStart, spectralEnd,
			successivePrev, successive, opts) {
			var precision = frame.precision;
			var samplesPerLine = frame.samplesPerLine;
			var scanLines = frame.scanLines;
			var mcusPerLine = frame.mcusPerLine;
			var progressive = frame.progressive;
			var maxH = frame.maxH, maxV = frame.maxV;

			var startOffset = offset, bitsData = 0, bitsCount = 0;
			function readBit() {
				if (bitsCount > 0) {
					bitsCount--;
					return (bitsData >> bitsCount) & 1;
				}
				bitsData = data[offset++];
				if (bitsData == 0xFF) {
					var nextByte = data[offset++];
					if (nextByte) {
						throw new Error("unexpected marker: " + ((bitsData << 8) | nextByte).toString(16));
					}
					// unstuff 0
				}
				bitsCount = 7;
				return bitsData >>> 7;
			}
			function decodeHuffman(tree) {
				var node = tree, bit;
				while ((bit = readBit()) !== null) {
					node = node[bit];
					if (typeof node === 'number')
						return node;
					if (typeof node !== 'object')
						throw new Error("invalid huffman sequence");
				}
				return null;
			}
			function receive(length) {
				var n = 0;
				while (length > 0) {
					var bit = readBit();
					if (bit === null) return;
					n = (n << 1) | bit;
					length--;
				}
				return n;
			}
			function receiveAndExtend(length) {
				var n = receive(length);
				if (n >= 1 << (length - 1))
					return n;
				return n + (-1 << length) + 1;
			}
			function decodeBaseline(component, zz) {
				var t = decodeHuffman(component.huffmanTableDC);
				var diff = t === 0 ? 0 : receiveAndExtend(t);
				zz[0] = (component.pred += diff);
				var k = 1;
				while (k < 64) {
					var rs = decodeHuffman(component.huffmanTableAC);
					var s = rs & 15, r = rs >> 4;
					if (s === 0) {
						if (r < 15)
							break;
						k += 16;
						continue;
					}
					k += r;
					var z = dctZigZag[k];
					zz[z] = receiveAndExtend(s);
					k++;
				}
			}
			function decodeDCFirst(component, zz) {
				var t = decodeHuffman(component.huffmanTableDC);
				var diff = t === 0 ? 0 : (receiveAndExtend(t) << successive);
				zz[0] = (component.pred += diff);
			}
			function decodeDCSuccessive(component, zz) {
				zz[0] |= readBit() << successive;
			}
			var eobrun = 0;
			function decodeACFirst(component, zz) {
				if (eobrun > 0) {
					eobrun--;
					return;
				}
				var k = spectralStart, e = spectralEnd;
				while (k <= e) {
					var rs = decodeHuffman(component.huffmanTableAC);
					var s = rs & 15, r = rs >> 4;
					if (s === 0) {
						if (r < 15) {
							eobrun = receive(r) + (1 << r) - 1;
							break;
						}
						k += 16;
						continue;
					}
					k += r;
					var z = dctZigZag[k];
					zz[z] = receiveAndExtend(s) * (1 << successive);
					k++;
				}
			}
			var successiveACState = 0, successiveACNextValue;
			function decodeACSuccessive(component, zz) {
				var k = spectralStart, e = spectralEnd, r = 0;
				while (k <= e) {
					var z = dctZigZag[k];
					var direction = zz[z] < 0 ? -1 : 1;
					switch (successiveACState) {
						case 0: // initial state
							var rs = decodeHuffman(component.huffmanTableAC);
							var s = rs & 15, r = rs >> 4;
							if (s === 0) {
								if (r < 15) {
									eobrun = receive(r) + (1 << r);
									successiveACState = 4;
								} else {
									r = 16;
									successiveACState = 1;
								}
							} else {
								if (s !== 1)
									throw new Error("invalid ACn encoding");
								successiveACNextValue = receiveAndExtend(s);
								successiveACState = r ? 2 : 3;
							}
							continue;
						case 1: // skipping r zero items
						case 2:
							if (zz[z])
								zz[z] += (readBit() << successive) * direction;
							else {
								r--;
								if (r === 0)
									successiveACState = successiveACState == 2 ? 3 : 0;
							}
							break;
						case 3: // set value for a zero item
							if (zz[z])
								zz[z] += (readBit() << successive) * direction;
							else {
								zz[z] = successiveACNextValue << successive;
								successiveACState = 0;
							}
							break;
						case 4: // eob
							if (zz[z])
								zz[z] += (readBit() << successive) * direction;
							break;
					}
					k++;
				}
				if (successiveACState === 4) {
					eobrun--;
					if (eobrun === 0)
						successiveACState = 0;
				}
			}
			function decodeMcu(component, decode, mcu, row, col) {
				var mcuRow = (mcu / mcusPerLine) | 0;
				var mcuCol = mcu % mcusPerLine;
				var blockRow = mcuRow * component.v + row;
				var blockCol = mcuCol * component.h + col;
				// If the block is missing and we're in tolerant mode, just skip it.
				if (component.blocks[blockRow] === undefined && opts.tolerantDecoding)
					return;
				decode(component, component.blocks[blockRow][blockCol]);
			}
			function decodeBlock(component, decode, mcu) {
				var blockRow = (mcu / component.blocksPerLine) | 0;
				var blockCol = mcu % component.blocksPerLine;
				// If the block is missing and we're in tolerant mode, just skip it.
				if (component.blocks[blockRow] === undefined && opts.tolerantDecoding)
					return;
				decode(component, component.blocks[blockRow][blockCol]);
			}

			var componentsLength = components.length;
			var component, i, j, k, n;
			var decodeFn;
			if (progressive) {
				if (spectralStart === 0)
					decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
				else
					decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
			} else {
				decodeFn = decodeBaseline;
			}

			var mcu = 0, marker;
			var mcuExpected;
			if (componentsLength == 1) {
				mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
			} else {
				mcuExpected = mcusPerLine * frame.mcusPerColumn;
			}
			if (!resetInterval) resetInterval = mcuExpected;

			var h, v;
			while (mcu < mcuExpected) {
				// reset interval stuff
				for (i = 0; i < componentsLength; i++)
					components[i].pred = 0;
				eobrun = 0;

				if (componentsLength == 1) {
					component = components[0];
					for (n = 0; n < resetInterval; n++) {
						decodeBlock(component, decodeFn, mcu);
						mcu++;
					}
				} else {
					for (n = 0; n < resetInterval; n++) {
						for (i = 0; i < componentsLength; i++) {
							component = components[i];
							h = component.h;
							v = component.v;
							for (j = 0; j < v; j++) {
								for (k = 0; k < h; k++) {
									decodeMcu(component, decodeFn, mcu, j, k);
								}
							}
						}
						mcu++;

						// If we've reached our expected MCU's, stop decoding
						if (mcu === mcuExpected) break;
					}
				}

				if (mcu === mcuExpected) {
					// Skip trailing bytes at the end of the scan - until we reach the next marker
					do {
						if (data[offset] === 0xFF) {
							if (data[offset + 1] !== 0x00) {
								break;
							}
						}
						offset += 1;
					} while (offset < data.length - 2);
				}

				// find marker
				bitsCount = 0;
				marker = (data[offset] << 8) | data[offset + 1];
				if (marker < 0xFF00) {
					throw new Error("marker was not found");
				}

				if (marker >= 0xFFD0 && marker <= 0xFFD7) { // RSTx
					offset += 2;
				}
				else
					break;
			}

			return offset - startOffset;
		}

		function buildComponentData(frame, component) {
			var lines = [];
			var blocksPerLine = component.blocksPerLine;
			var blocksPerColumn = component.blocksPerColumn;
			var samplesPerLine = blocksPerLine << 3;
			// Only 1 used per invocation of this function and garbage collected after invocation, so no need to account for its memory footprint.
			var R = new Int32Array(64), r = new Uint8Array(64);

			// A port of poppler's IDCT method which in turn is taken from:
			//   Christoph Loeffler, Adriaan Ligtenberg, George S. Moschytz,
			//   "Practical Fast 1-D DCT Algorithms with 11 Multiplications",
			//   IEEE Intl. Conf. on Acoustics, Speech & Signal Processing, 1989,
			//   988-991.
			function quantizeAndInverse(zz, dataOut, dataIn) {
				var qt = component.quantizationTable;
				var v0, v1, v2, v3, v4, v5, v6, v7, t;
				var p = dataIn;
				var i;

				// dequant
				for (i = 0; i < 64; i++)
					p[i] = zz[i] * qt[i];

				// inverse DCT on rows
				for (i = 0; i < 8; ++i) {
					var row = 8 * i;

					// check for all-zero AC coefficients
					if (p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 &&
						p[4 + row] == 0 && p[5 + row] == 0 && p[6 + row] == 0 &&
						p[7 + row] == 0) {
						t = (dctSqrt2 * p[0 + row] + 512) >> 10;
						p[0 + row] = t;
						p[1 + row] = t;
						p[2 + row] = t;
						p[3 + row] = t;
						p[4 + row] = t;
						p[5 + row] = t;
						p[6 + row] = t;
						p[7 + row] = t;
						continue;
					}

					// stage 4
					v0 = (dctSqrt2 * p[0 + row] + 128) >> 8;
					v1 = (dctSqrt2 * p[4 + row] + 128) >> 8;
					v2 = p[2 + row];
					v3 = p[6 + row];
					v4 = (dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
					v7 = (dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
					v5 = p[3 + row] << 4;
					v6 = p[5 + row] << 4;

					// stage 3
					t = (v0 - v1 + 1) >> 1;
					v0 = (v0 + v1 + 1) >> 1;
					v1 = t;
					t = (v2 * dctSin6 + v3 * dctCos6 + 128) >> 8;
					v2 = (v2 * dctCos6 - v3 * dctSin6 + 128) >> 8;
					v3 = t;
					t = (v4 - v6 + 1) >> 1;
					v4 = (v4 + v6 + 1) >> 1;
					v6 = t;
					t = (v7 + v5 + 1) >> 1;
					v5 = (v7 - v5 + 1) >> 1;
					v7 = t;

					// stage 2
					t = (v0 - v3 + 1) >> 1;
					v0 = (v0 + v3 + 1) >> 1;
					v3 = t;
					t = (v1 - v2 + 1) >> 1;
					v1 = (v1 + v2 + 1) >> 1;
					v2 = t;
					t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
					v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
					v7 = t;
					t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
					v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
					v6 = t;

					// stage 1
					p[0 + row] = v0 + v7;
					p[7 + row] = v0 - v7;
					p[1 + row] = v1 + v6;
					p[6 + row] = v1 - v6;
					p[2 + row] = v2 + v5;
					p[5 + row] = v2 - v5;
					p[3 + row] = v3 + v4;
					p[4 + row] = v3 - v4;
				}

				// inverse DCT on columns
				for (i = 0; i < 8; ++i) {
					var col = i;

					// check for all-zero AC coefficients
					if (p[1 * 8 + col] == 0 && p[2 * 8 + col] == 0 && p[3 * 8 + col] == 0 &&
						p[4 * 8 + col] == 0 && p[5 * 8 + col] == 0 && p[6 * 8 + col] == 0 &&
						p[7 * 8 + col] == 0) {
						t = (dctSqrt2 * dataIn[i + 0] + 8192) >> 14;
						p[0 * 8 + col] = t;
						p[1 * 8 + col] = t;
						p[2 * 8 + col] = t;
						p[3 * 8 + col] = t;
						p[4 * 8 + col] = t;
						p[5 * 8 + col] = t;
						p[6 * 8 + col] = t;
						p[7 * 8 + col] = t;
						continue;
					}

					// stage 4
					v0 = (dctSqrt2 * p[0 * 8 + col] + 2048) >> 12;
					v1 = (dctSqrt2 * p[4 * 8 + col] + 2048) >> 12;
					v2 = p[2 * 8 + col];
					v3 = p[6 * 8 + col];
					v4 = (dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048) >> 12;
					v7 = (dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048) >> 12;
					v5 = p[3 * 8 + col];
					v6 = p[5 * 8 + col];

					// stage 3
					t = (v0 - v1 + 1) >> 1;
					v0 = (v0 + v1 + 1) >> 1;
					v1 = t;
					t = (v2 * dctSin6 + v3 * dctCos6 + 2048) >> 12;
					v2 = (v2 * dctCos6 - v3 * dctSin6 + 2048) >> 12;
					v3 = t;
					t = (v4 - v6 + 1) >> 1;
					v4 = (v4 + v6 + 1) >> 1;
					v6 = t;
					t = (v7 + v5 + 1) >> 1;
					v5 = (v7 - v5 + 1) >> 1;
					v7 = t;

					// stage 2
					t = (v0 - v3 + 1) >> 1;
					v0 = (v0 + v3 + 1) >> 1;
					v3 = t;
					t = (v1 - v2 + 1) >> 1;
					v1 = (v1 + v2 + 1) >> 1;
					v2 = t;
					t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
					v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
					v7 = t;
					t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
					v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
					v6 = t;

					// stage 1
					p[0 * 8 + col] = v0 + v7;
					p[7 * 8 + col] = v0 - v7;
					p[1 * 8 + col] = v1 + v6;
					p[6 * 8 + col] = v1 - v6;
					p[2 * 8 + col] = v2 + v5;
					p[5 * 8 + col] = v2 - v5;
					p[3 * 8 + col] = v3 + v4;
					p[4 * 8 + col] = v3 - v4;
				}

				// convert to 8-bit integers
				for (i = 0; i < 64; ++i) {
					var sample = 128 + ((p[i] + 8) >> 4);
					dataOut[i] = sample < 0 ? 0 : sample > 0xFF ? 0xFF : sample;
				}
			}

			requestMemoryAllocation(samplesPerLine * blocksPerColumn * 8);

			var i, j;
			for (var blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
				var scanLine = blockRow << 3;
				for (i = 0; i < 8; i++)
					lines.push(new Uint8Array(samplesPerLine));
				for (var blockCol = 0; blockCol < blocksPerLine; blockCol++) {
					quantizeAndInverse(component.blocks[blockRow][blockCol], r, R);

					var offset = 0, sample = blockCol << 3;
					for (j = 0; j < 8; j++) {
						var line = lines[scanLine + j];
						for (i = 0; i < 8; i++)
							line[sample + i] = r[offset++];
					}
				}
			}
			return lines;
		}

		function clampTo8bit(a) {
			return a < 0 ? 0 : a > 255 ? 255 : a;
		}

		constructor.prototype = {
			load: function load(path) {
				var xhr = new XMLHttpRequest();
				xhr.open("GET", path, true);
				xhr.responseType = "arraybuffer";
				xhr.onload = (function () {
					// TODO catch parse error
					var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
					this.parse(data);
					if (this.onload)
						this.onload();
				}).bind(this);
				xhr.send(null);
			},
			parse: function parse(data) {
				var maxResolutionInPixels = this.opts.maxResolutionInMP * 1000 * 1000;
				var offset = 0, length = data.length;
				function readUint16() {
					var value = (data[offset] << 8) | data[offset + 1];
					offset += 2;
					return value;
				}
				function readDataBlock() {
					var length = readUint16();
					var array = data.subarray(offset, offset + length - 2);
					offset += array.length;
					return array;
				}
				function prepareComponents(frame) {
					// According to the JPEG standard, the sampling factor must be between 1 and 4
					// See https://github.com/libjpeg-turbo/libjpeg-turbo/blob/9abeff46d87bd201a952e276f3e4339556a403a3/libjpeg.txt#L1138-L1146
					var maxH = 1, maxV = 1;
					var component, componentId;
					for (componentId in frame.components) {
						if (frame.components.hasOwnProperty(componentId)) {
							component = frame.components[componentId];
							if (maxH < component.h) maxH = component.h;
							if (maxV < component.v) maxV = component.v;
						}
					}
					var mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / maxH);
					var mcusPerColumn = Math.ceil(frame.scanLines / 8 / maxV);
					for (componentId in frame.components) {
						if (frame.components.hasOwnProperty(componentId)) {
							component = frame.components[componentId];
							var blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / maxH);
							var blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * component.v / maxV);
							var blocksPerLineForMcu = mcusPerLine * component.h;
							var blocksPerColumnForMcu = mcusPerColumn * component.v;
							var blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;
							var blocks = [];

							// Each block is a Int32Array of length 64 (4 x 64 = 256 bytes)
							requestMemoryAllocation(blocksToAllocate * 256);

							for (var i = 0; i < blocksPerColumnForMcu; i++) {
								var row = [];
								for (var j = 0; j < blocksPerLineForMcu; j++)
									row.push(new Int32Array(64));
								blocks.push(row);
							}
							component.blocksPerLine = blocksPerLine;
							component.blocksPerColumn = blocksPerColumn;
							component.blocks = blocks;
						}
					}
					frame.maxH = maxH;
					frame.maxV = maxV;
					frame.mcusPerLine = mcusPerLine;
					frame.mcusPerColumn = mcusPerColumn;
				}
				var jfif = null;
				var adobe = null;
				var pixels = null;
				var frame, resetInterval;
				var quantizationTables = [], frames = [];
				var huffmanTablesAC = [], huffmanTablesDC = [];
				var fileMarker = readUint16();
				var malformedDataOffset = -1;
				this.comments = [];
				if (fileMarker != 0xFFD8) { // SOI (Start of Image)
					throw new Error("SOI not found");
				}

				fileMarker = readUint16();
				while (fileMarker != 0xFFD9) { // EOI (End of image)
					var i, j, l;
					switch (fileMarker) {
						case 0xFF00: break;
						case 0xFFE0: // APP0 (Application Specific)
						case 0xFFE1: // APP1
						case 0xFFE2: // APP2
						case 0xFFE3: // APP3
						case 0xFFE4: // APP4
						case 0xFFE5: // APP5
						case 0xFFE6: // APP6
						case 0xFFE7: // APP7
						case 0xFFE8: // APP8
						case 0xFFE9: // APP9
						case 0xFFEA: // APP10
						case 0xFFEB: // APP11
						case 0xFFEC: // APP12
						case 0xFFED: // APP13
						case 0xFFEE: // APP14
						case 0xFFEF: // APP15
						case 0xFFFE: // COM (Comment)
							var appData = readDataBlock();

							if (fileMarker === 0xFFFE) {
								var comment = String.fromCharCode.apply(null, appData);
								this.comments.push(comment);
							}

							if (fileMarker === 0xFFE0) {
								if (appData[0] === 0x4A && appData[1] === 0x46 && appData[2] === 0x49 &&
									appData[3] === 0x46 && appData[4] === 0) { // 'JFIF\x00'
									jfif = {
										version: { major: appData[5], minor: appData[6] },
										densityUnits: appData[7],
										xDensity: (appData[8] << 8) | appData[9],
										yDensity: (appData[10] << 8) | appData[11],
										thumbWidth: appData[12],
										thumbHeight: appData[13],
										thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
									};
								}
							}
							// TODO APP1 - Exif
							if (fileMarker === 0xFFE1) {
								if (appData[0] === 0x45 &&
									appData[1] === 0x78 &&
									appData[2] === 0x69 &&
									appData[3] === 0x66 &&
									appData[4] === 0) { // 'EXIF\x00'
									this.exifBuffer = appData.subarray(5, appData.length);
								}
							}

							if (fileMarker === 0xFFEE) {
								if (appData[0] === 0x41 && appData[1] === 0x64 && appData[2] === 0x6F &&
									appData[3] === 0x62 && appData[4] === 0x65 && appData[5] === 0) { // 'Adobe\x00'
									adobe = {
										version: appData[6],
										flags0: (appData[7] << 8) | appData[8],
										flags1: (appData[9] << 8) | appData[10],
										transformCode: appData[11]
									};
								}
							}
							break;

						case 0xFFDB: // DQT (Define Quantization Tables)
							var quantizationTablesLength = readUint16();
							var quantizationTablesEnd = quantizationTablesLength + offset - 2;
							while (offset < quantizationTablesEnd) {
								var quantizationTableSpec = data[offset++];
								requestMemoryAllocation(64 * 4);
								var tableData = new Int32Array(64);
								if ((quantizationTableSpec >> 4) === 0) { // 8 bit values
									for (j = 0; j < 64; j++) {
										var z = dctZigZag[j];
										tableData[z] = data[offset++];
									}
								} else if ((quantizationTableSpec >> 4) === 1) { //16 bit
									for (j = 0; j < 64; j++) {
										var z = dctZigZag[j];
										tableData[z] = readUint16();
									}
								} else
									throw new Error("DQT: invalid table spec");
								quantizationTables[quantizationTableSpec & 15] = tableData;
							}
							break;

						case 0xFFC0: // SOF0 (Start of Frame, Baseline DCT)
						case 0xFFC1: // SOF1 (Start of Frame, Extended DCT)
						case 0xFFC2: // SOF2 (Start of Frame, Progressive DCT)
							readUint16(); // skip data length
							frame = {};
							frame.extended = (fileMarker === 0xFFC1);
							frame.progressive = (fileMarker === 0xFFC2);
							frame.precision = data[offset++];
							frame.scanLines = readUint16();
							frame.samplesPerLine = readUint16();
							frame.components = {};
							frame.componentsOrder = [];

							var pixelsInFrame = frame.scanLines * frame.samplesPerLine;
							if (pixelsInFrame > maxResolutionInPixels) {
								var exceededAmount = Math.ceil((pixelsInFrame - maxResolutionInPixels) / 1e6);
								throw new Error(`maxResolutionInMP limit exceeded by ${exceededAmount}MP`);
							}

							var componentsCount = data[offset++], componentId;
							var maxH = 0, maxV = 0;
							for (i = 0; i < componentsCount; i++) {
								componentId = data[offset];
								var h = data[offset + 1] >> 4;
								var v = data[offset + 1] & 15;
								var qId = data[offset + 2];

								if (h <= 0 || v <= 0) {
									throw new Error('Invalid sampling factor, expected values above 0');
								}

								frame.componentsOrder.push(componentId);
								frame.components[componentId] = {
									h: h,
									v: v,
									quantizationIdx: qId
								};
								offset += 3;
							}
							prepareComponents(frame);
							frames.push(frame);
							break;

						case 0xFFC4: // DHT (Define Huffman Tables)
							var huffmanLength = readUint16();
							for (i = 2; i < huffmanLength;) {
								var huffmanTableSpec = data[offset++];
								var codeLengths = new Uint8Array(16);
								var codeLengthSum = 0;
								for (j = 0; j < 16; j++, offset++) {
									codeLengthSum += (codeLengths[j] = data[offset]);
								}
								requestMemoryAllocation(16 + codeLengthSum);
								var huffmanValues = new Uint8Array(codeLengthSum);
								for (j = 0; j < codeLengthSum; j++, offset++)
									huffmanValues[j] = data[offset];
								i += 17 + codeLengthSum;

								((huffmanTableSpec >> 4) === 0 ?
									huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] =
									buildHuffmanTable(codeLengths, huffmanValues);
							}
							break;

						case 0xFFDD: // DRI (Define Restart Interval)
							readUint16(); // skip data length
							resetInterval = readUint16();
							break;

						case 0xFFDC: // Number of Lines marker
							readUint16() // skip data length
							readUint16() // Ignore this data since it represents the image height
							break;

						case 0xFFDA: // SOS (Start of Scan)
							var scanLength = readUint16();
							var selectorsCount = data[offset++];
							var components = [], component;
							for (i = 0; i < selectorsCount; i++) {
								component = frame.components[data[offset++]];
								var tableSpec = data[offset++];
								component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
								component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
								components.push(component);
							}
							var spectralStart = data[offset++];
							var spectralEnd = data[offset++];
							var successiveApproximation = data[offset++];
							var processed = decodeScan(data, offset,
								frame, components, resetInterval,
								spectralStart, spectralEnd,
								successiveApproximation >> 4, successiveApproximation & 15, this.opts);
							offset += processed;
							break;

						case 0xFFFF: // Fill bytes
							if (data[offset] !== 0xFF) { // Avoid skipping a valid marker.
								offset--;
							}
							break;
						default:
							if (data[offset - 3] == 0xFF &&
								data[offset - 2] >= 0xC0 && data[offset - 2] <= 0xFE) {
								// could be incorrect encoding -- last 0xFF byte of the previous
								// block was eaten by the encoder
								offset -= 3;
								break;
							}
							else if (fileMarker === 0xE0 || fileMarker == 0xE1) {
								// Recover from malformed APP1 markers popular in some phone models.
								// See https://github.com/eugeneware/jpeg-js/issues/82
								if (malformedDataOffset !== -1) {
									throw new Error(`first unknown JPEG marker at offset ${malformedDataOffset.toString(16)}, second unknown JPEG marker ${fileMarker.toString(16)} at offset ${(offset - 1).toString(16)}`);
								}
								malformedDataOffset = offset - 1;
								const nextOffset = readUint16();
								if (data[offset + nextOffset - 2] === 0xFF) {
									offset += nextOffset - 2;
									break;
								}
							}
							throw new Error("unknown JPEG marker " + fileMarker.toString(16));
					}
					fileMarker = readUint16();
				}
				if (frames.length != 1)
					throw new Error("only single frame JPEGs supported");

				// set each frame's components quantization table
				for (var i = 0; i < frames.length; i++) {
					var cp = frames[i].components;
					for (var j in cp) {
						cp[j].quantizationTable = quantizationTables[cp[j].quantizationIdx];
						delete cp[j].quantizationIdx;
					}
				}

				this.width = frame.samplesPerLine;
				this.height = frame.scanLines;
				this.jfif = jfif;
				this.adobe = adobe;
				this.components = [];
				for (var i = 0; i < frame.componentsOrder.length; i++) {
					var component = frame.components[frame.componentsOrder[i]];
					this.components.push({
						lines: buildComponentData(frame, component),
						scaleX: component.h / frame.maxH,
						scaleY: component.v / frame.maxV
					});
				}
			},
			getData: function getData(width, height) {
				var scaleX = this.width / width, scaleY = this.height / height;

				var component1, component2, component3, component4;
				var component1Line, component2Line, component3Line, component4Line;
				var x, y;
				var offset = 0;
				var Y, Cb, Cr, K, C, M, Ye, R, G, B;
				var colorTransform;
				var dataLength = width * height * this.components.length;
				requestMemoryAllocation(dataLength);
				var data = new Uint8Array(dataLength);
				switch (this.components.length) {
					case 1:
						component1 = this.components[0];
						for (y = 0; y < height; y++) {
							component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
							for (x = 0; x < width; x++) {
								Y = component1Line[0 | (x * component1.scaleX * scaleX)];

								data[offset++] = Y;
							}
						}
						break;
					case 2:
						// PDF might compress two component data in custom colorspace
						component1 = this.components[0];
						component2 = this.components[1];
						for (y = 0; y < height; y++) {
							component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
							component2Line = component2.lines[0 | (y * component2.scaleY * scaleY)];
							for (x = 0; x < width; x++) {
								Y = component1Line[0 | (x * component1.scaleX * scaleX)];
								data[offset++] = Y;
								Y = component2Line[0 | (x * component2.scaleX * scaleX)];
								data[offset++] = Y;
							}
						}
						break;
					case 3:
						// The default transform for three components is true
						colorTransform = true;
						// The adobe transform marker overrides any previous setting
						if (this.adobe && this.adobe.transformCode)
							colorTransform = true;
						else if (typeof this.opts.colorTransform !== 'undefined')
							colorTransform = !!this.opts.colorTransform;

						component1 = this.components[0];
						component2 = this.components[1];
						component3 = this.components[2];
						for (y = 0; y < height; y++) {
							component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
							component2Line = component2.lines[0 | (y * component2.scaleY * scaleY)];
							component3Line = component3.lines[0 | (y * component3.scaleY * scaleY)];
							for (x = 0; x < width; x++) {
								if (!colorTransform) {
									R = component1Line[0 | (x * component1.scaleX * scaleX)];
									G = component2Line[0 | (x * component2.scaleX * scaleX)];
									B = component3Line[0 | (x * component3.scaleX * scaleX)];
								} else {
									Y = component1Line[0 | (x * component1.scaleX * scaleX)];
									Cb = component2Line[0 | (x * component2.scaleX * scaleX)];
									Cr = component3Line[0 | (x * component3.scaleX * scaleX)];

									R = clampTo8bit(Y + 1.402 * (Cr - 128));
									G = clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
									B = clampTo8bit(Y + 1.772 * (Cb - 128));
								}

								data[offset++] = R;
								data[offset++] = G;
								data[offset++] = B;
							}
						}
						break;
					case 4:
						if (!this.adobe)
							throw new Error('Unsupported color mode (4 components)');
						// The default transform for four components is false
						colorTransform = false;
						// The adobe transform marker overrides any previous setting
						if (this.adobe && this.adobe.transformCode)
							colorTransform = true;
						else if (typeof this.opts.colorTransform !== 'undefined')
							colorTransform = !!this.opts.colorTransform;

						component1 = this.components[0];
						component2 = this.components[1];
						component3 = this.components[2];
						component4 = this.components[3];
						for (y = 0; y < height; y++) {
							component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
							component2Line = component2.lines[0 | (y * component2.scaleY * scaleY)];
							component3Line = component3.lines[0 | (y * component3.scaleY * scaleY)];
							component4Line = component4.lines[0 | (y * component4.scaleY * scaleY)];
							for (x = 0; x < width; x++) {
								if (!colorTransform) {
									C = component1Line[0 | (x * component1.scaleX * scaleX)];
									M = component2Line[0 | (x * component2.scaleX * scaleX)];
									Ye = component3Line[0 | (x * component3.scaleX * scaleX)];
									K = component4Line[0 | (x * component4.scaleX * scaleX)];
								} else {
									Y = component1Line[0 | (x * component1.scaleX * scaleX)];
									Cb = component2Line[0 | (x * component2.scaleX * scaleX)];
									Cr = component3Line[0 | (x * component3.scaleX * scaleX)];
									K = component4Line[0 | (x * component4.scaleX * scaleX)];

									C = 255 - clampTo8bit(Y + 1.402 * (Cr - 128));
									M = 255 - clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
									Ye = 255 - clampTo8bit(Y + 1.772 * (Cb - 128));
								}
								data[offset++] = 255 - C;
								data[offset++] = 255 - M;
								data[offset++] = 255 - Ye;
								data[offset++] = 255 - K;
							}
						}
						break;
					default:
						throw new Error('Unsupported color mode');
				}
				return data;
			},
			copyToImageData: function copyToImageData(imageData, formatAsRGBA) {
				var width = imageData.width, height = imageData.height;
				var imageDataArray = imageData.data;
				var data = this.getData(width, height);
				var i = 0, j = 0, x, y;
				var Y, K, C, M, R, G, B;
				switch (this.components.length) {
					case 1:
						for (y = 0; y < height; y++) {
							for (x = 0; x < width; x++) {
								Y = data[i++];

								imageDataArray[j++] = Y;
								imageDataArray[j++] = Y;
								imageDataArray[j++] = Y;
								if (formatAsRGBA) {
									imageDataArray[j++] = 255;
								}
							}
						}
						break;
					case 3:
						for (y = 0; y < height; y++) {
							for (x = 0; x < width; x++) {
								R = data[i++];
								G = data[i++];
								B = data[i++];

								imageDataArray[j++] = R;
								imageDataArray[j++] = G;
								imageDataArray[j++] = B;
								if (formatAsRGBA) {
									imageDataArray[j++] = 255;
								}
							}
						}
						break;
					case 4:
						for (y = 0; y < height; y++) {
							for (x = 0; x < width; x++) {
								C = data[i++];
								M = data[i++];
								Y = data[i++];
								K = data[i++];

								R = 255 - clampTo8bit(C * (1 - K / 255) + K);
								G = 255 - clampTo8bit(M * (1 - K / 255) + K);
								B = 255 - clampTo8bit(Y * (1 - K / 255) + K);

								imageDataArray[j++] = R;
								imageDataArray[j++] = G;
								imageDataArray[j++] = B;
								if (formatAsRGBA) {
									imageDataArray[j++] = 255;
								}
							}
						}
						break;
					default:
						throw new Error('Unsupported color mode');
				}
			}
		};


		// We cap the amount of memory used by jpeg-js to avoid unexpected OOMs from untrusted content.
		var totalBytesAllocated = 0;
		var maxMemoryUsageBytes = 0;
		function requestMemoryAllocation(increaseAmount = 0) {
			var totalMemoryImpactBytes = totalBytesAllocated + increaseAmount;
			if (totalMemoryImpactBytes > maxMemoryUsageBytes) {
				var exceededAmount = Math.ceil((totalMemoryImpactBytes - maxMemoryUsageBytes) / 1024 / 1024);
				throw new Error(`maxMemoryUsageInMB limit exceeded by at least ${exceededAmount}MB`);
			}

			totalBytesAllocated = totalMemoryImpactBytes;
		}

		constructor.resetMaxMemoryUsage = function (maxMemoryUsageBytes_) {
			totalBytesAllocated = 0;
			maxMemoryUsageBytes = maxMemoryUsageBytes_;
		};

		constructor.getBytesAllocated = function () {
			return totalBytesAllocated;
		};

		constructor.requestMemoryAllocation = requestMemoryAllocation;

		return constructor;
	})();

	function decode(jpegData, userOpts = {}) {
		var defaultOpts = {
			// "undefined" means "Choose whether to transform colors based on the image’s color model."
			colorTransform: undefined,
			useTArray: false,
			formatAsRGBA: true,
			tolerantDecoding: true,
			maxResolutionInMP: 100, // Don't decode more than 100 megapixels
			maxMemoryUsageInMB: 512, // Don't decode if memory footprint is more than 512MB
		};

		var opts = { ...defaultOpts, ...userOpts };
		var arr = new Uint8Array(jpegData);
		var decoder = new JpegImage();
		decoder.opts = opts;
		// If this constructor ever supports async decoding this will need to be done differently.
		// Until then, treating as singleton limit is fine.
		JpegImage.resetMaxMemoryUsage(opts.maxMemoryUsageInMB * 1024 * 1024);
		decoder.parse(arr);

		var channels = (opts.formatAsRGBA) ? 4 : 3;
		var bytesNeeded = decoder.width * decoder.height * channels;
		try {
			JpegImage.requestMemoryAllocation(bytesNeeded);
			var image = {
				width: decoder.width,
				height: decoder.height,
				exifBuffer: decoder.exifBuffer,
				data: opts.useTArray ?
					new Uint8Array(bytesNeeded) :
					Buffer.alloc(bytesNeeded)
			};
			if (decoder.comments.length > 0) {
				image["comments"] = decoder.comments;
			}
		} catch (err) {
			if (err instanceof RangeError) {
				throw new Error("Could not allocate enough memory for the image. " +
					"Required: " + bytesNeeded);
			}

			if (err instanceof ReferenceError) {
				if (err.message === "Buffer is not defined") {
					throw new Error("Buffer is not globally defined in this environment. " +
						"Consider setting useTArray to true");
				}
			}
			throw err;
		}

		decoder.copyToImageData(image, opts.formatAsRGBA);

		return image;
	}

	return {
		decode
	};
})();

const ZLib = (() => {
	/*
	* Extracted from pdf.js
	* https://github.com/andreasgal/pdf.js
	*
	* Copyright (c) 2011 Mozilla Foundation
	*
	* Contributors: Andreas Gal <gal@mozilla.com>
	*               Chris G Jones <cjones@mozilla.com>
	*               Shaon Barman <shaon.barman@gmail.com>
	*               Vivien Nicolas <21@vingtetun.org>
	*               Justin D'Arcangelo <justindarc@gmail.com>
	*               Yury Delendik
	*
	* Permission is hereby granted, free of charge, to any person obtaining a
	* copy of this software and associated documentation files (the "Software"),
	* to deal in the Software without restriction, including without limitation
	* the rights to use, copy, modify, merge, publish, distribute, sublicense,
	* and/or sell copies of the Software, and to permit persons to whom the
	* Software is furnished to do so, subject to the following conditions:
	*
	* The above copyright notice and this permission notice shall be included in
	* all copies or substantial portions of the Software.
	*
	* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
	* THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
	* FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
	* DEALINGS IN THE SOFTWARE.
	*/

	const DecodeStream = (function () {
		function constructor() {
			this.pos = 0;
			this.bufferLength = 0;
			this.eof = false;
			this.buffer = null;
		}

		constructor.prototype = {
			ensureBuffer: function decodestream_ensureBuffer(requested) {
				var buffer = this.buffer;
				var current = buffer ? buffer.byteLength : 0;
				if (requested < current)
					return buffer;
				var size = 512;
				while (size < requested)
					size <<= 1;
				var buffer2 = new Uint8Array(size);
				for (var i = 0; i < current; ++i)
					buffer2[i] = buffer[i];
				return this.buffer = buffer2;
			},
			getByte: function decodestream_getByte() {
				var pos = this.pos;
				while (this.bufferLength <= pos) {
					if (this.eof)
						return null;
					this.readBlock();
				}
				return this.buffer[this.pos++];
			},
			getBytes: function decodestream_getBytes(length) {
				var pos = this.pos;

				if (length) {
					this.ensureBuffer(pos + length);
					var end = pos + length;

					while (!this.eof && this.bufferLength < end)
						this.readBlock();

					var bufEnd = this.bufferLength;
					if (end > bufEnd)
						end = bufEnd;
				} else {
					while (!this.eof)
						this.readBlock();

					var end = this.bufferLength;
				}

				this.pos = end;
				return this.buffer.subarray(pos, end);
			},
			lookChar: function decodestream_lookChar() {
				var pos = this.pos;
				while (this.bufferLength <= pos) {
					if (this.eof)
						return null;
					this.readBlock();
				}
				return String.fromCharCode(this.buffer[this.pos]);
			},
			getChar: function decodestream_getChar() {
				var pos = this.pos;
				while (this.bufferLength <= pos) {
					if (this.eof)
						return null;
					this.readBlock();
				}
				return String.fromCharCode(this.buffer[this.pos++]);
			},
			makeSubStream: function decodestream_makeSubstream(start, length, dict) {
				var end = start + length;
				while (this.bufferLength <= end && !this.eof)
					this.readBlock();
				return new Stream(this.buffer, start, length, dict);
			},
			skip: function decodestream_skip(n) {
				if (!n)
					n = 1;
				this.pos += n;
			},
			reset: function decodestream_reset() {
				this.pos = 0;
			}
		};

		return constructor;
	})();

	const FlateStream = (function () {
		var codeLenCodeMap = new Uint32Array([
			16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
		]);

		var lengthDecode = new Uint32Array([
			0x00003, 0x00004, 0x00005, 0x00006, 0x00007, 0x00008, 0x00009, 0x0000a,
			0x1000b, 0x1000d, 0x1000f, 0x10011, 0x20013, 0x20017, 0x2001b, 0x2001f,
			0x30023, 0x3002b, 0x30033, 0x3003b, 0x40043, 0x40053, 0x40063, 0x40073,
			0x50083, 0x500a3, 0x500c3, 0x500e3, 0x00102, 0x00102, 0x00102
		]);

		var distDecode = new Uint32Array([
			0x00001, 0x00002, 0x00003, 0x00004, 0x10005, 0x10007, 0x20009, 0x2000d,
			0x30011, 0x30019, 0x40021, 0x40031, 0x50041, 0x50061, 0x60081, 0x600c1,
			0x70101, 0x70181, 0x80201, 0x80301, 0x90401, 0x90601, 0xa0801, 0xa0c01,
			0xb1001, 0xb1801, 0xc2001, 0xc3001, 0xd4001, 0xd6001
		]);

		var fixedLitCodeTab = [new Uint32Array([
			0x70100, 0x80050, 0x80010, 0x80118, 0x70110, 0x80070, 0x80030, 0x900c0,
			0x70108, 0x80060, 0x80020, 0x900a0, 0x80000, 0x80080, 0x80040, 0x900e0,
			0x70104, 0x80058, 0x80018, 0x90090, 0x70114, 0x80078, 0x80038, 0x900d0,
			0x7010c, 0x80068, 0x80028, 0x900b0, 0x80008, 0x80088, 0x80048, 0x900f0,
			0x70102, 0x80054, 0x80014, 0x8011c, 0x70112, 0x80074, 0x80034, 0x900c8,
			0x7010a, 0x80064, 0x80024, 0x900a8, 0x80004, 0x80084, 0x80044, 0x900e8,
			0x70106, 0x8005c, 0x8001c, 0x90098, 0x70116, 0x8007c, 0x8003c, 0x900d8,
			0x7010e, 0x8006c, 0x8002c, 0x900b8, 0x8000c, 0x8008c, 0x8004c, 0x900f8,
			0x70101, 0x80052, 0x80012, 0x8011a, 0x70111, 0x80072, 0x80032, 0x900c4,
			0x70109, 0x80062, 0x80022, 0x900a4, 0x80002, 0x80082, 0x80042, 0x900e4,
			0x70105, 0x8005a, 0x8001a, 0x90094, 0x70115, 0x8007a, 0x8003a, 0x900d4,
			0x7010d, 0x8006a, 0x8002a, 0x900b4, 0x8000a, 0x8008a, 0x8004a, 0x900f4,
			0x70103, 0x80056, 0x80016, 0x8011e, 0x70113, 0x80076, 0x80036, 0x900cc,
			0x7010b, 0x80066, 0x80026, 0x900ac, 0x80006, 0x80086, 0x80046, 0x900ec,
			0x70107, 0x8005e, 0x8001e, 0x9009c, 0x70117, 0x8007e, 0x8003e, 0x900dc,
			0x7010f, 0x8006e, 0x8002e, 0x900bc, 0x8000e, 0x8008e, 0x8004e, 0x900fc,
			0x70100, 0x80051, 0x80011, 0x80119, 0x70110, 0x80071, 0x80031, 0x900c2,
			0x70108, 0x80061, 0x80021, 0x900a2, 0x80001, 0x80081, 0x80041, 0x900e2,
			0x70104, 0x80059, 0x80019, 0x90092, 0x70114, 0x80079, 0x80039, 0x900d2,
			0x7010c, 0x80069, 0x80029, 0x900b2, 0x80009, 0x80089, 0x80049, 0x900f2,
			0x70102, 0x80055, 0x80015, 0x8011d, 0x70112, 0x80075, 0x80035, 0x900ca,
			0x7010a, 0x80065, 0x80025, 0x900aa, 0x80005, 0x80085, 0x80045, 0x900ea,
			0x70106, 0x8005d, 0x8001d, 0x9009a, 0x70116, 0x8007d, 0x8003d, 0x900da,
			0x7010e, 0x8006d, 0x8002d, 0x900ba, 0x8000d, 0x8008d, 0x8004d, 0x900fa,
			0x70101, 0x80053, 0x80013, 0x8011b, 0x70111, 0x80073, 0x80033, 0x900c6,
			0x70109, 0x80063, 0x80023, 0x900a6, 0x80003, 0x80083, 0x80043, 0x900e6,
			0x70105, 0x8005b, 0x8001b, 0x90096, 0x70115, 0x8007b, 0x8003b, 0x900d6,
			0x7010d, 0x8006b, 0x8002b, 0x900b6, 0x8000b, 0x8008b, 0x8004b, 0x900f6,
			0x70103, 0x80057, 0x80017, 0x8011f, 0x70113, 0x80077, 0x80037, 0x900ce,
			0x7010b, 0x80067, 0x80027, 0x900ae, 0x80007, 0x80087, 0x80047, 0x900ee,
			0x70107, 0x8005f, 0x8001f, 0x9009e, 0x70117, 0x8007f, 0x8003f, 0x900de,
			0x7010f, 0x8006f, 0x8002f, 0x900be, 0x8000f, 0x8008f, 0x8004f, 0x900fe,
			0x70100, 0x80050, 0x80010, 0x80118, 0x70110, 0x80070, 0x80030, 0x900c1,
			0x70108, 0x80060, 0x80020, 0x900a1, 0x80000, 0x80080, 0x80040, 0x900e1,
			0x70104, 0x80058, 0x80018, 0x90091, 0x70114, 0x80078, 0x80038, 0x900d1,
			0x7010c, 0x80068, 0x80028, 0x900b1, 0x80008, 0x80088, 0x80048, 0x900f1,
			0x70102, 0x80054, 0x80014, 0x8011c, 0x70112, 0x80074, 0x80034, 0x900c9,
			0x7010a, 0x80064, 0x80024, 0x900a9, 0x80004, 0x80084, 0x80044, 0x900e9,
			0x70106, 0x8005c, 0x8001c, 0x90099, 0x70116, 0x8007c, 0x8003c, 0x900d9,
			0x7010e, 0x8006c, 0x8002c, 0x900b9, 0x8000c, 0x8008c, 0x8004c, 0x900f9,
			0x70101, 0x80052, 0x80012, 0x8011a, 0x70111, 0x80072, 0x80032, 0x900c5,
			0x70109, 0x80062, 0x80022, 0x900a5, 0x80002, 0x80082, 0x80042, 0x900e5,
			0x70105, 0x8005a, 0x8001a, 0x90095, 0x70115, 0x8007a, 0x8003a, 0x900d5,
			0x7010d, 0x8006a, 0x8002a, 0x900b5, 0x8000a, 0x8008a, 0x8004a, 0x900f5,
			0x70103, 0x80056, 0x80016, 0x8011e, 0x70113, 0x80076, 0x80036, 0x900cd,
			0x7010b, 0x80066, 0x80026, 0x900ad, 0x80006, 0x80086, 0x80046, 0x900ed,
			0x70107, 0x8005e, 0x8001e, 0x9009d, 0x70117, 0x8007e, 0x8003e, 0x900dd,
			0x7010f, 0x8006e, 0x8002e, 0x900bd, 0x8000e, 0x8008e, 0x8004e, 0x900fd,
			0x70100, 0x80051, 0x80011, 0x80119, 0x70110, 0x80071, 0x80031, 0x900c3,
			0x70108, 0x80061, 0x80021, 0x900a3, 0x80001, 0x80081, 0x80041, 0x900e3,
			0x70104, 0x80059, 0x80019, 0x90093, 0x70114, 0x80079, 0x80039, 0x900d3,
			0x7010c, 0x80069, 0x80029, 0x900b3, 0x80009, 0x80089, 0x80049, 0x900f3,
			0x70102, 0x80055, 0x80015, 0x8011d, 0x70112, 0x80075, 0x80035, 0x900cb,
			0x7010a, 0x80065, 0x80025, 0x900ab, 0x80005, 0x80085, 0x80045, 0x900eb,
			0x70106, 0x8005d, 0x8001d, 0x9009b, 0x70116, 0x8007d, 0x8003d, 0x900db,
			0x7010e, 0x8006d, 0x8002d, 0x900bb, 0x8000d, 0x8008d, 0x8004d, 0x900fb,
			0x70101, 0x80053, 0x80013, 0x8011b, 0x70111, 0x80073, 0x80033, 0x900c7,
			0x70109, 0x80063, 0x80023, 0x900a7, 0x80003, 0x80083, 0x80043, 0x900e7,
			0x70105, 0x8005b, 0x8001b, 0x90097, 0x70115, 0x8007b, 0x8003b, 0x900d7,
			0x7010d, 0x8006b, 0x8002b, 0x900b7, 0x8000b, 0x8008b, 0x8004b, 0x900f7,
			0x70103, 0x80057, 0x80017, 0x8011f, 0x70113, 0x80077, 0x80037, 0x900cf,
			0x7010b, 0x80067, 0x80027, 0x900af, 0x80007, 0x80087, 0x80047, 0x900ef,
			0x70107, 0x8005f, 0x8001f, 0x9009f, 0x70117, 0x8007f, 0x8003f, 0x900df,
			0x7010f, 0x8006f, 0x8002f, 0x900bf, 0x8000f, 0x8008f, 0x8004f, 0x900ff
		]), 9];

		var fixedDistCodeTab = [new Uint32Array([
			0x50000, 0x50010, 0x50008, 0x50018, 0x50004, 0x50014, 0x5000c, 0x5001c,
			0x50002, 0x50012, 0x5000a, 0x5001a, 0x50006, 0x50016, 0x5000e, 0x00000,
			0x50001, 0x50011, 0x50009, 0x50019, 0x50005, 0x50015, 0x5000d, 0x5001d,
			0x50003, 0x50013, 0x5000b, 0x5001b, 0x50007, 0x50017, 0x5000f, 0x00000
		]), 5];

		function error(e) {
			throw new Error(e)
		}

		function constructor(bytes) {
			//var bytes = stream.getBytes();
			var bytesPos = 0;

			var cmf = bytes[bytesPos++];
			var flg = bytes[bytesPos++];
			if (cmf == -1 || flg == -1)
				error('Invalid header in flate stream');
			if ((cmf & 0x0f) != 0x08)
				error('Unknown compression method in flate stream');
			if ((((cmf << 8) + flg) % 31) != 0)
				error('Bad FCHECK in flate stream');
			if (flg & 0x20)
				error('FDICT bit set in flate stream');

			this.bytes = bytes;
			this.bytesPos = bytesPos;

			this.codeSize = 0;
			this.codeBuf = 0;

			DecodeStream.call(this);
		}

		constructor.prototype = Object.create(DecodeStream.prototype);

		constructor.prototype.getBits = function (bits) {
			var codeSize = this.codeSize;
			var codeBuf = this.codeBuf;
			var bytes = this.bytes;
			var bytesPos = this.bytesPos;

			var b;
			while (codeSize < bits) {
				if (typeof (b = bytes[bytesPos++]) == 'undefined')
					error('Bad encoding in flate stream');
				codeBuf |= b << codeSize;
				codeSize += 8;
			}
			b = codeBuf & ((1 << bits) - 1);
			this.codeBuf = codeBuf >> bits;
			this.codeSize = codeSize -= bits;
			this.bytesPos = bytesPos;
			return b;
		};

		constructor.prototype.getCode = function (table) {
			var codes = table[0];
			var maxLen = table[1];
			var codeSize = this.codeSize;
			var codeBuf = this.codeBuf;
			var bytes = this.bytes;
			var bytesPos = this.bytesPos;

			while (codeSize < maxLen) {
				var b;
				if (typeof (b = bytes[bytesPos++]) == 'undefined')
					error('Bad encoding in flate stream');
				codeBuf |= (b << codeSize);
				codeSize += 8;
			}
			var code = codes[codeBuf & ((1 << maxLen) - 1)];
			var codeLen = code >> 16;
			var codeVal = code & 0xffff;
			if (codeSize == 0 || codeSize < codeLen || codeLen == 0)
				error('Bad encoding in flate stream');
			this.codeBuf = (codeBuf >> codeLen);
			this.codeSize = (codeSize - codeLen);
			this.bytesPos = bytesPos;
			return codeVal;
		};

		constructor.prototype.generateHuffmanTable = function (lengths) {
			var n = lengths.length;

			// find max code length
			var maxLen = 0;
			for (var i = 0; i < n; ++i) {
				if (lengths[i] > maxLen)
					maxLen = lengths[i];
			}

			// build the table
			var size = 1 << maxLen;
			var codes = new Uint32Array(size);
			for (var len = 1, code = 0, skip = 2;
				len <= maxLen;
				++len, code <<= 1, skip <<= 1) {
				for (var val = 0; val < n; ++val) {
					if (lengths[val] == len) {
						// bit-reverse the code
						var code2 = 0;
						var t = code;
						for (var i = 0; i < len; ++i) {
							code2 = (code2 << 1) | (t & 1);
							t >>= 1;
						}

						// fill the table entries
						for (var i = code2; i < size; i += skip)
							codes[i] = (len << 16) | val;

						++code;
					}
				}
			}

			return [codes, maxLen];
		};

		constructor.prototype.readBlock = function () {
			function repeat(stream, array, len, offset, what) {
				var repeat = stream.getBits(len) + offset;
				while (repeat-- > 0)
					array[i++] = what;
			}

			// read block header
			var hdr = this.getBits(3);
			if (hdr & 1)
				this.eof = true;
			hdr >>= 1;

			if (hdr == 0) { // uncompressed block
				var bytes = this.bytes;
				var bytesPos = this.bytesPos;
				var b;

				if (typeof (b = bytes[bytesPos++]) == 'undefined')
					error('Bad block header in flate stream');
				var blockLen = b;
				if (typeof (b = bytes[bytesPos++]) == 'undefined')
					error('Bad block header in flate stream');
				blockLen |= (b << 8);
				if (typeof (b = bytes[bytesPos++]) == 'undefined')
					error('Bad block header in flate stream');
				var check = b;
				if (typeof (b = bytes[bytesPos++]) == 'undefined')
					error('Bad block header in flate stream');
				check |= (b << 8);
				if (check != (~blockLen & 0xffff))
					error('Bad uncompressed block length in flate stream');

				this.codeBuf = 0;
				this.codeSize = 0;

				var bufferLength = this.bufferLength;
				var buffer = this.ensureBuffer(bufferLength + blockLen);
				var end = bufferLength + blockLen;
				this.bufferLength = end;
				for (var n = bufferLength; n < end; ++n) {
					if (typeof (b = bytes[bytesPos++]) == 'undefined') {
						this.eof = true;
						break;
					}
					buffer[n] = b;
				}
				this.bytesPos = bytesPos;
				return;
			}

			var litCodeTable;
			var distCodeTable;
			if (hdr == 1) { // compressed block, fixed codes
				litCodeTable = fixedLitCodeTab;
				distCodeTable = fixedDistCodeTab;
			} else if (hdr == 2) { // compressed block, dynamic codes
				var numLitCodes = this.getBits(5) + 257;
				var numDistCodes = this.getBits(5) + 1;
				var numCodeLenCodes = this.getBits(4) + 4;

				// build the code lengths code table
				var codeLenCodeLengths = Array(codeLenCodeMap.length);
				var i = 0;
				while (i < numCodeLenCodes)
					codeLenCodeLengths[codeLenCodeMap[i++]] = this.getBits(3);
				var codeLenCodeTab = this.generateHuffmanTable(codeLenCodeLengths);

				// build the literal and distance code tables
				var len = 0;
				var i = 0;
				var codes = numLitCodes + numDistCodes;
				var codeLengths = new Array(codes);
				while (i < codes) {
					var code = this.getCode(codeLenCodeTab);
					if (code == 16) {
						repeat(this, codeLengths, 2, 3, len);
					} else if (code == 17) {
						repeat(this, codeLengths, 3, 3, len = 0);
					} else if (code == 18) {
						repeat(this, codeLengths, 7, 11, len = 0);
					} else {
						codeLengths[i++] = len = code;
					}
				}

				litCodeTable =
					this.generateHuffmanTable(codeLengths.slice(0, numLitCodes));
				distCodeTable =
					this.generateHuffmanTable(codeLengths.slice(numLitCodes, codes));
			} else {
				error('Unknown block type in flate stream');
			}

			var buffer = this.buffer;
			var limit = buffer ? buffer.length : 0;
			var pos = this.bufferLength;
			while (true) {
				var code1 = this.getCode(litCodeTable);
				if (code1 < 256) {
					if (pos + 1 >= limit) {
						buffer = this.ensureBuffer(pos + 1);
						limit = buffer.length;
					}
					buffer[pos++] = code1;
					continue;
				}
				if (code1 == 256) {
					this.bufferLength = pos;
					return;
				}
				code1 -= 257;
				code1 = lengthDecode[code1];
				var code2 = code1 >> 16;
				if (code2 > 0)
					code2 = this.getBits(code2);
				var len = (code1 & 0xffff) + code2;
				code1 = this.getCode(distCodeTable);
				code1 = distDecode[code1];
				code2 = code1 >> 16;
				if (code2 > 0)
					code2 = this.getBits(code2);
				var dist = (code1 & 0xffff) + code2;
				if (pos + len >= limit) {
					buffer = this.ensureBuffer(pos + len);
					limit = buffer.length;
				}
				for (var k = 0; k < len; ++k, ++pos)
					buffer[pos] = buffer[pos - dist];
			}
		};

		return constructor;
	})();

	return {
		DecodeStream,
		FlateStream
	};
})();

/*
 * MIT LICENSE
 * Copyright (c) 2011 Devon Govett
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
 * to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const PNG = (function () {
	let APNG_DISPOSE_OP_NONE = 0;
	let APNG_DISPOSE_OP_BACKGROUND = 1;
	let APNG_DISPOSE_OP_PREVIOUS = 2;
	let APNG_BLEND_OP_SOURCE = 0;
	let APNG_BLEND_OP_OVER = 1;
	let scratchCanvas = document.createElement('canvas');
	let scratchCtx = scratchCanvas.getContext('2d');
	let makeImage = function (imageData) {
		scratchCtx.width = imageData.width;
		scratchCtx.height = imageData.height;
		scratchCtx.clearRect(0, 0, imageData.width, imageData.height);
		scratchCtx.putImageData(imageData, 0, 0);

		const img = new Image();
		img.src = scratchCanvas.toDataURL();
		return img;
	};

	class PNG {
		static load(url, canvas, callback) {
			if (typeof canvas === 'function') {
				callback = canvas;
			}

			const xhr = new XMLHttpRequest();
			xhr.open('GET', url, true);
			xhr.responseType = 'arraybuffer';
			xhr.onload = () => {
				const data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
				const png = new PNG(data);
				if (typeof (canvas && canvas.getContext) === 'function') {
					png.render(canvas);
				}
				return typeof callback === 'function' ? callback(png) : undefined;
			};

			return xhr.send(null);
		}

		constructor(data1) {
			let i;
			this.data = data1;
			this.pos = 8; // Skip the default header

			this.palette = [];
			this.imgData = [];
			this.transparency = {};
			this.animation = null;
			this.text = {};
			let frame = null;

			while (true) {
				var data;
				let chunkSize = this.readUInt32();
				let section = '';
				for (i = 0; i < 4; i++) {
					section += String.fromCharCode(this.data[this.pos++]);
				}

				switch (section) {
					case 'IHDR':
						// we can grab  interesting values from here (like width, height, etc)
						this.width = this.readUInt32();
						this.height = this.readUInt32();
						this.bits = this.data[this.pos++];
						this.colorType = this.data[this.pos++];
						this.compressionMethod = this.data[this.pos++];
						this.filterMethod = this.data[this.pos++];
						this.interlaceMethod = this.data[this.pos++];
						break;

					case 'acTL':
						// we have an animated PNG
						this.animation = {
							numFrames: this.readUInt32(),
							numPlays: this.readUInt32() || Infinity,
							frames: []
						};
						break;

					case 'PLTE':
						this.palette = this.read(chunkSize);
						break;

					case 'fcTL':
						if (frame) {
							this.animation.frames.push(frame);
						}

						this.pos += 4; // skip sequence number
						frame = {
							width: this.readUInt32(),
							height: this.readUInt32(),
							xOffset: this.readUInt32(),
							yOffset: this.readUInt32()
						};

						var delayNum = this.readUInt16();
						var delayDen = this.readUInt16() || 100;
						frame.delay = (1000 * delayNum) / delayDen;

						frame.disposeOp = this.data[this.pos++];
						frame.blendOp = this.data[this.pos++];
						frame.data = [];
						break;

					case 'IDAT':
					case 'fdAT':
						if (section === 'fdAT') {
							this.pos += 4; // skip sequence number
							chunkSize -= 4;
						}

						data = (frame && frame.data) || this.imgData;
						for (i = 0; i < chunkSize; i++) {
							data.push(this.data[this.pos++]);
						}
						break;

					case 'tRNS':
						// This chunk can only occur once and it must occur after the
						// PLTE chunk and before the IDAT chunk.
						this.transparency = {};
						switch (this.colorType) {
							case 3:
								// Indexed color, RGB. Each byte in this chunk is an alpha for
								// the palette index in the PLTE ("palette") chunk up until the
								// last non-opaque entry. Set up an array, stretching over all
								// palette entries which will be 0 (opaque) or 1 (transparent).
								this.transparency.indexed = this.read(chunkSize);
								var short = 255 - this.transparency.indexed.length;
								if (short > 0) {
									for (i = 0; i < short; i++) {
										this.transparency.indexed.push(255);
									}
								}
								break;
							case 0:
								// Greyscale. Corresponding to entries in the PLTE chunk.
								// Grey is two bytes, range 0 .. (2 ^ bit-depth) - 1
								this.transparency.grayscale = this.read(chunkSize)[0];
								break;
							case 2:
								// True color with proper alpha channel.
								this.transparency.rgb = this.read(chunkSize);
								break;
						}
						break;

					case 'tEXt':
						var text = this.read(chunkSize);
						var index = text.indexOf(0);
						var key = String.fromCharCode.apply(String, text.slice(0, index));
						this.text[key] = String.fromCharCode.apply(
							String,
							text.slice(index + 1)
						);
						break;

					case 'IEND':
						if (frame) {
							this.animation.frames.push(frame);
						}

						// we've got everything we need!
						switch (this.colorType) {
							case 0:
							case 3:
							case 4:
								this.colors = 1;
								break;
							case 2:
							case 6:
								this.colors = 3;
								break;
						}

						this.hasAlphaChannel = [4, 6].includes(this.colorType);
						var colors = this.colors + (this.hasAlphaChannel ? 1 : 0);
						this.pixelBitlength = this.bits * colors;

						switch (this.colors) {
							case 1:
								this.colorSpace = 'DeviceGray';
								break;
							case 3:
								this.colorSpace = 'DeviceRGB';
								break;
						}

						this.imgData = new Uint8Array(this.imgData);
						return;
						break;

					default:
						// unknown (or unimportant) section, skip it
						this.pos += chunkSize;
				}

				this.pos += 4; // Skip the CRC

				if (this.pos > this.data.length) {
					throw new Error('Incomplete or corrupt PNG file');
				}
			}
		}

		read(bytes) {
			const result = new Array(bytes);
			for (let i = 0; i < bytes; i++) {
				result[i] = this.data[this.pos++];
			}
			return result;
		}

		readUInt32() {
			const b1 = this.data[this.pos++] << 24;
			const b2 = this.data[this.pos++] << 16;
			const b3 = this.data[this.pos++] << 8;
			const b4 = this.data[this.pos++];
			return b1 | b2 | b3 | b4;
		}

		readUInt16() {
			const b1 = this.data[this.pos++] << 8;
			const b2 = this.data[this.pos++];
			return b1 | b2;
		}

		decodePixels(data) {
			if (data == null) {
				data = this.imgData;
			}
			if (data.length === 0) {
				return new Uint8Array(0);
			}

			data = new ZLib.FlateStream(data);
			data = data.getBytes();

			const { width, height } = this;
			const pixelBytes = this.pixelBitlength / 8;

			const pixels = new Uint8Array(width * height * pixelBytes);
			const { length } = data;
			let pos = 0;

			function pass(x0, y0, dx, dy, singlePass = false) {
				const w = Math.ceil((width - x0) / dx);
				const h = Math.ceil((height - y0) / dy);
				const scanlineLength = pixelBytes * w;
				const buffer = singlePass ? pixels : new Uint8Array(scanlineLength * h);
				let row = 0;
				let c = 0;
				while (row < h && pos < length) {
					var byte, col, i, left, upper;
					switch (data[pos++]) {
						case 0: // None
							for (i = 0; i < scanlineLength; i++) {
								buffer[c++] = data[pos++];
							}
							break;

						case 1: // Sub
							for (i = 0; i < scanlineLength; i++) {
								byte = data[pos++];
								left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
								buffer[c++] = (byte + left) % 256;
							}
							break;

						case 2: // Up
							for (i = 0; i < scanlineLength; i++) {
								byte = data[pos++];
								col = (i - (i % pixelBytes)) / pixelBytes;
								upper =
									row &&
									buffer[
									(row - 1) * scanlineLength +
									col * pixelBytes +
									(i % pixelBytes)
									];
								buffer[c++] = (upper + byte) % 256;
							}
							break;

						case 3: // Average
							for (i = 0; i < scanlineLength; i++) {
								byte = data[pos++];
								col = (i - (i % pixelBytes)) / pixelBytes;
								left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
								upper =
									row &&
									buffer[
									(row - 1) * scanlineLength +
									col * pixelBytes +
									(i % pixelBytes)
									];
								buffer[c++] = (byte + Math.floor((left + upper) / 2)) % 256;
							}
							break;

						case 4: // Paeth
							for (i = 0; i < scanlineLength; i++) {
								var paeth, upperLeft;
								byte = data[pos++];
								col = (i - (i % pixelBytes)) / pixelBytes;
								left = i < pixelBytes ? 0 : buffer[c - pixelBytes];

								if (row === 0) {
									upper = upperLeft = 0;
								} else {
									upper =
										buffer[
										(row - 1) * scanlineLength +
										col * pixelBytes +
										(i % pixelBytes)
										];
									upperLeft =
										col &&
										buffer[
										(row - 1) * scanlineLength +
										(col - 1) * pixelBytes +
										(i % pixelBytes)
										];
								}

								const p = left + upper - upperLeft;
								const pa = Math.abs(p - left);
								const pb = Math.abs(p - upper);
								const pc = Math.abs(p - upperLeft);

								if (pa <= pb && pa <= pc) {
									paeth = left;
								} else if (pb <= pc) {
									paeth = upper;
								} else {
									paeth = upperLeft;
								}

								buffer[c++] = (byte + paeth) % 256;
							}
							break;

						default:
							throw new Error(`Invalid filter algorithm: ${data[pos - 1]}`);
					}

					if (!singlePass) {
						let pixelsPos = ((y0 + row * dy) * width + x0) * pixelBytes;
						let bufferPos = row * scanlineLength;
						for (i = 0; i < w; i++) {
							for (let j = 0; j < pixelBytes; j++)
								pixels[pixelsPos++] = buffer[bufferPos++];
							pixelsPos += (dx - 1) * pixelBytes;
						}
					}

					row++;
				}
			}

			if (this.interlaceMethod === 1) {
				/*
				  1 6 4 6 2 6 4 6
				  7 7 7 7 7 7 7 7
				  5 6 5 6 5 6 5 6
				  7 7 7 7 7 7 7 7
				  3 6 4 6 3 6 4 6
				  7 7 7 7 7 7 7 7
				  5 6 5 6 5 6 5 6
				  7 7 7 7 7 7 7 7
				*/
				pass(0, 0, 8, 8); // 1
				pass(4, 0, 8, 8); // 2
				pass(0, 4, 4, 8); // 3
				pass(2, 0, 4, 4); // 4
				pass(0, 2, 2, 4); // 5
				pass(1, 0, 2, 2); // 6
				pass(0, 1, 1, 2); // 7
			} else {
				pass(0, 0, 1, 1, true);
			}

			return pixels;
		}

		decodePalette() {
			const { palette } = this;
			const { length } = palette;
			const transparency = this.transparency.indexed || [];
			const ret = new Uint8Array((transparency.length || 0) + length);
			let pos = 0;
			let c = 0;

			for (let i = 0; i < length; i += 3) {
				var left;
				ret[pos++] = palette[i];
				ret[pos++] = palette[i + 1];
				ret[pos++] = palette[i + 2];
				ret[pos++] = (left = transparency[c++]) != null ? left : 255;
			}

			return ret;
		}

		copyToImageData(imageData, pixels) {
			let j, k;
			let { colors } = this;
			let palette = null;
			let alpha = this.hasAlphaChannel;

			if (this.palette.length) {
				palette =
					this._decodedPalette || (this._decodedPalette = this.decodePalette());
				colors = 4;
				alpha = true;
			}

			const data = imageData.data || imageData;
			const { length } = data;
			const input = palette || pixels;
			let i = (j = 0);

			if (colors === 1) {
				while (i < length) {
					k = palette ? pixels[i / 4] * 4 : j;
					const v = input[k++];
					data[i++] = v;
					data[i++] = v;
					data[i++] = v;
					data[i++] = alpha ? input[k++] : 255;
					j = k;
				}
			} else {
				while (i < length) {
					k = palette ? pixels[i / 4] * 4 : j;
					data[i++] = input[k++];
					data[i++] = input[k++];
					data[i++] = input[k++];
					data[i++] = alpha ? input[k++] : 255;
					j = k;
				}
			}
		}

		decode() {
			const ret = new Uint8Array(this.width * this.height * 4);
			this.copyToImageData(ret, this.decodePixels());
			return ret;
		}

		decodeFrames(ctx) {
			if (!this.animation) {
				return;
			}

			for (let i = 0; i < this.animation.frames.length; i++) {
				const frame = this.animation.frames[i];
				const imageData = ctx.createImageData(frame.width, frame.height);
				const pixels = this.decodePixels(new Uint8Array(frame.data));

				this.copyToImageData(imageData, pixels);
				frame.imageData = imageData;
				frame.image = makeImage(imageData);
			}
		}

		renderFrame(ctx, number) {
			const { frames } = this.animation;
			const frame = frames[number];
			const prev = frames[number - 1];

			// if we're on the first frame, clear the canvas
			if (number === 0) {
				ctx.clearRect(0, 0, this.width, this.height);
			}

			// check the previous frame's dispose operation
			if ((prev && prev.disposeOp) === APNG_DISPOSE_OP_BACKGROUND) {
				ctx.clearRect(prev.xOffset, prev.yOffset, prev.width, prev.height);
			} else if ((prev && prev.disposeOp) === APNG_DISPOSE_OP_PREVIOUS) {
				ctx.putImageData(prev.imageData, prev.xOffset, prev.yOffset);
			}

			// APNG_BLEND_OP_SOURCE overwrites the previous data
			if (frame.blendOp === APNG_BLEND_OP_SOURCE) {
				ctx.clearRect(frame.xOffset, frame.yOffset, frame.width, frame.height);
			}

			// draw the current frame
			return ctx.drawImage(frame.image, frame.xOffset, frame.yOffset);
		}

		animate(ctx) {
			let frameNumber = 0;
			const { numFrames, frames, numPlays } = this.animation;

			const doFrame = () => {
				const f = frameNumber++ % numFrames;
				const frame = frames[f];
				this.renderFrame(ctx, f);

				if (numFrames > 1 && frameNumber / numFrames < numPlays) {
					this.animation._timeout = setTimeout(doFrame, frame.delay);
				}
			};

			doFrame();
		}

		stopAnimation() {
			return clearTimeout(this.animation && this.animation._timeout);
		}

		render(canvas) {
			// if this canvas was displaying another image before,
			// stop the animation on it
			if (canvas._png) {
				canvas._png.stopAnimation();
			}

			canvas._png = this;
			canvas.width = this.width;
			canvas.height = this.height;
			const ctx = canvas.getContext('2d');

			if (this.animation) {
				this.decodeFrames(ctx);
				return this.animate(ctx);
			} else {
				const data = ctx.createImageData(this.width, this.height);
				this.copyToImageData(data, this.decodePixels());
				return ctx.putImageData(data, 0, 0);
			}
		}
	}
	return PNG;
})();

// https://github.com/jpeg-js/jpeg-js/blob/master/lib/decoder.js
// https://github.com/foliojs/png.js/blob/master/zlib.js
// https://github.com/foliojs/png.js/blob/master/png.js
// https://github.com/commonsmachinery/blockhash-js/blob/master/index.js
// https://github.com/LinusU/blockhash-core/blob/master/index.js

const BlockHash = (() => {
	function median(data) {
		var mdarr = data.slice(0)
		mdarr.sort(function (a, b) { return a - b })

		if (mdarr.length % 2 === 0) {
			return (mdarr[mdarr.length / 2 - 1] + mdarr[mdarr.length / 2]) / 2.0
		}

		return mdarr[Math.floor(mdarr.length / 2)]
	}

	function translateBlocksToBits(blocks, pixelsPerBlock) {
		var halfBlockValue = pixelsPerBlock * 256 * 3 / 2
		var bandsize = blocks.length / 4

		// Compare medians across four horizontal bands
		for (var i = 0; i < 4; i++) {
			var m = median(blocks.slice(i * bandsize, (i + 1) * bandsize))
			for (var j = i * bandsize; j < (i + 1) * bandsize; j++) {
				var v = blocks[j]

				// Output a 1 if the block is brighter than the median.
				// With images dominated by black or white, the median may
				// end up being 0 or the max value, and thus having a lot
				// of blocks of value equal to the median.  To avoid
				// generating hashes of all zeros or ones, in that case output
				// 0 if the median is in the lower value space, 1 otherwise
				blocks[j] = Number(v > m || (Math.abs(v - m) < 1 && m > halfBlockValue))
			}
		}
	}

	function bitsToHexhash(bitsArray) {
		var hex = []

		for (var i = 0; i < bitsArray.length; i += 4) {
			var nibble = bitsArray.slice(i, i + 4)
			hex.push(parseInt(nibble.join(''), 2).toString(16))
		}

		return hex.join('')
	}

	function bmvbhashEven(data, bits) {
		var blocksizeX = Math.floor(data.width / bits)
		var blocksizeY = Math.floor(data.height / bits)

		var result = []

		for (var y = 0; y < bits; y++) {
			for (var x = 0; x < bits; x++) {
				var total = 0

				for (var iy = 0; iy < blocksizeY; iy++) {
					for (var ix = 0; ix < blocksizeX; ix++) {
						var cx = x * blocksizeX + ix
						var cy = y * blocksizeY + iy
						var ii = (cy * data.width + cx) * 4

						var alpha = data.data[ii + 3]
						total += (alpha === 0) ? 765 : data.data[ii] + data.data[ii + 1] + data.data[ii + 2]
					}
				}

				result.push(total)
			}
		}

		translateBlocksToBits(result, blocksizeX * blocksizeY)

		return bitsToHexhash(result)
	}

	function bmvbhash(data, bits) {
		var result = []

		var i, j, x, y
		var blockWidth, blockHeight
		var weightTop, weightBottom, weightLeft, weightRight
		var blockTop, blockBottom, blockLeft, blockRight
		var yMod, yFrac, yInt
		var xMod, xFrac, xInt
		var blocks = []

		var evenX = data.width % bits === 0
		var evenY = data.height % bits === 0

		if (evenX && evenY) {
			return bmvbhashEven(data, bits)
		}

		// initialize blocks array with 0s
		for (i = 0; i < bits; i++) {
			blocks.push([])
			for (j = 0; j < bits; j++) {
				blocks[i].push(0)
			}
		}

		blockWidth = data.width / bits
		blockHeight = data.height / bits

		for (y = 0; y < data.height; y++) {
			if (evenY) {
				// don't bother dividing y, if the size evenly divides by bits
				blockTop = blockBottom = Math.floor(y / blockHeight)
				weightTop = 1
				weightBottom = 0
			} else {
				yMod = (y + 1) % blockHeight
				yFrac = yMod - Math.floor(yMod)
				yInt = yMod - yFrac

				weightTop = (1 - yFrac)
				weightBottom = (yFrac)

				// yInt will be 0 on bottom/right borders and on block boundaries
				if (yInt > 0 || (y + 1) === data.height) {
					blockTop = blockBottom = Math.floor(y / blockHeight)
				} else {
					blockTop = Math.floor(y / blockHeight)
					blockBottom = Math.ceil(y / blockHeight)
				}
			}

			for (x = 0; x < data.width; x++) {
				var ii = (y * data.width + x) * 4

				var alpha = data.data[ii + 3]
				var avgvalue = (alpha === 0) ? 765 : data.data[ii] + data.data[ii + 1] + data.data[ii + 2]

				if (evenX) {
					blockLeft = blockRight = Math.floor(x / blockWidth)
					weightLeft = 1
					weightRight = 0
				} else {
					xMod = (x + 1) % blockWidth
					xFrac = xMod - Math.floor(xMod)
					xInt = xMod - xFrac

					weightLeft = (1 - xFrac)
					weightRight = xFrac

					// xInt will be 0 on bottom/right borders and on block boundaries
					if (xInt > 0 || (x + 1) === data.width) {
						blockLeft = blockRight = Math.floor(x / blockWidth)
					} else {
						blockLeft = Math.floor(x / blockWidth)
						blockRight = Math.ceil(x / blockWidth)
					}
				}

				// add weighted pixel value to relevant blocks
				blocks[blockTop][blockLeft] += avgvalue * weightTop * weightLeft
				blocks[blockTop][blockRight] += avgvalue * weightTop * weightRight
				blocks[blockBottom][blockLeft] += avgvalue * weightBottom * weightLeft
				blocks[blockBottom][blockRight] += avgvalue * weightBottom * weightRight
			}
		}

		for (i = 0; i < bits; i++) {
			for (j = 0; j < bits; j++) {
				result.push(blocks[i][j])
			}
		}

		translateBlocksToBits(result, blockWidth * blockHeight)

		return bitsToHexhash(result)
	}

	return {
		bmvbhash,
		bmvbhashEven
	}
})();

const getImageData = (data) => {
	switch (image.format) {
		case 'jpg':
			return JPG.decode(data.image, { useTArray: true })
		case 'png':
			const png = new PNG(data.image)
			return {
				width: png.width,
				height: png.height,
				data: new Uint8Array(png.width * png.height * 4)
			}
		default:
			throw new Error('Unsupported Format')
	}
}

self.onmessage = (e) => {
	try {
		const data = getImageData(e.data)
		self.postMessage({
			id: e.data.id,
			hash: BlockHash.bmvbhash(data, 16)
		})
	} catch (err) {
		self.postMessage({
			id: e.data.id,
			err: err
		})
	}
}
