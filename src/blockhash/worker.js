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
