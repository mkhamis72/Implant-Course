// Chart downloads from the Explore page: the SVG straight from ECharts, or a PNG drawn from it at twice the size on
// white (CSP allows data: and blob: images).

export function chartFileName(outcomeKey: string, today: string, ext: 'svg' | 'png'): string {
  return `explore-${outcomeKey}-${today}.${ext}`
}

export function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * 2
      canvas.height = height * 2
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('No canvas'))
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the chart'))), 'image/png')
    }
    img.onerror = () => reject(new Error('Could not draw the chart'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
