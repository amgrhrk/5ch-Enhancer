const getImageData = (image) => {
	switch (image.format) {
		case 'jpg':
			return JPG.decode(image.image, { useTArray: true })
		case 'png':
			const png = new PNG(new Uint8Array(image.image))
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
