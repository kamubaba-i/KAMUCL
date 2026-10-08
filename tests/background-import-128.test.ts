import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { encodeManagedImageBuffer, type ImageCodec, type DecodedImage } from '../src/main/core/imageAssetProcessor'

const sharpCodec: ImageCodec = {
  async decode(data) {
    try {
      const image = sharp(data, { failOn: 'none' })
      await image.metadata()
      const raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const { width, height } = raw.info
      const pixels = raw.data
      const wrap = (data: Buffer): DecodedImage => ({
        width,
        height,
        hasAlpha: () => pixels.some((v, i) => i % 4 === 3 && v !== 0xff),
        async resize(w, h) {
          return wrap(await sharp(data, { failOn: 'none' }).resize(w, h).ensureAlpha().raw().toBuffer())
        },
        async toPNG() {
          return sharp(data, { failOn: 'none' }).resize(width, height).png().toBuffer()
        },
        async toJPEG() {
          return sharp(data, { failOn: 'none' }).resize(width, height).jpeg().toBuffer()
        }
      })
      return wrap(data)
    } catch {
      return null
    }
  }
}

test('伪装扩展名的导入报错指出真实格式与可操作的处理方式', async () => {
  // 网页/聊天工具保存图片时常见：内容是 WebP/JPEG，文件名却是 .png（#28）
  const webpAsPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } }).webp().toBuffer()
  await assert.rejects(
    () => encodeManagedImageBuffer(webpAsPng, 'wallpaper.png', 'background', sharpCodec),
    /实际是 WebP.*\.webp/s
  )

  const jpegAsPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } }).jpeg().toBuffer()
  await assert.rejects(
    () => encodeManagedImageBuffer(jpegAsPng, 'photo.png', 'background', sharpCodec),
    /实际是 JPG.*\.jpg/s
  )

  const garbage = Buffer.from('this is definitely not an image at all.....')
  await assert.rejects(
    () => encodeManagedImageBuffer(garbage, 'broken.png', 'background', sharpCodec),
    /无法识别图片格式或尺寸/
  )
})
