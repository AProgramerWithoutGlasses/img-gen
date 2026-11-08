"""Generate synthetic, non-private boundary fixtures. Never calls an API."""
import argparse
import random
from pathlib import Path
from PIL import Image, ImageDraw

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    large = Image.new('RGB', (6000, 4000), '#f4e6cc')
    d = ImageDraw.Draw(large)
    d.rectangle((300, 1700, 1100, 2500), fill='#cc3333')
    d.ellipse((2400, 1400, 3600, 2600), fill='#ee9933')
    d.rectangle((4900, 1700, 5700, 2500), fill='#33aa55')
    large.save(args.output/'large.jpg', quality=95)
    reference = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    ImageDraw.Draw(reference).regular_polygon((256, 256, 150), 5, fill='#3388dd')
    reference.save(args.output/'alpha.png')
    thin = large.resize((4096, 64))
    thin.save(args.output/'thin.jpg', quality=95)
    # A legal <12 MiB indexed PNG that expands substantially on decode/resize.
    rng = random.Random(20261103)
    dense = Image.frombytes('P', (4096, 3072), rng.randbytes(4096*3072))
    palette = []
    for i in range(256): palette.extend((i, (i*71)%256, (i*131)%256))
    dense.putpalette(palette)
    dense.info['transparency'] = bytes(80+i%176 for i in range(256))
    ImageDraw.Draw(dense).ellipse((1400, 900, 2700, 2200), fill=50)
    dense.save(args.output/'dense-alpha.png', optimize=True)
    # Scaling an indexed PNG turns it into RGBA: the encoded result can grow.
    packed = Image.frombytes('P', (4500, 2500), rng.randbytes(4500*2500))
    packed.putpalette(palette)
    packed.info['transparency'] = dense.info['transparency']
    ImageDraw.Draw(packed).ellipse((1600, 650, 2900, 1950), fill=50)
    packed.save(args.output/'packed-alpha.png', optimize=True)
    for p in args.output.iterdir():
        with Image.open(p) as im:
            im.load()
            print(p.name, im.size, im.mode, p.stat().st_size)

if __name__ == '__main__': main()
