#!/usr/bin/env python3
"""Rebuild index.html from source/People Finder App.dc.html.

index.html is a self-contained bundle: its <head> (inlined fonts, dc runtime,
LIFF SDK) and assets are kept as-is; only the page body after </helmet>
(markup + Component logic) is replaced with the one from the source file.

    python3 tools/build_bundle.py
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'source' / 'People Finder App.dc.html'
BUNDLE = ROOT / 'index.html'

# source path -> asset id already stored in the bundle manifest
ASSETS = {
    'uploads/wallpaperiphone.PNG': '86121368-70f1-44a6-9c3d-6cf25b26989a',
    'uploads/ov70_crop.png': '93b27c44-738a-4aae-9255-25c086608fef',
}

TEMPLATE_RE = re.compile(r'(<script type="__bundler/template">\n)(.*?)(\n\s*</script>)', re.S)


def main():
    bundle = BUNDLE.read_text(encoding='utf-8')
    source = SOURCE.read_text(encoding='utf-8')

    m = TEMPLATE_RE.search(bundle)
    template = json.loads(m.group(2))

    marker = '</helmet>'
    body = source[source.index(marker):]
    for path, asset_id in ASSETS.items():
        assert path in body, f'asset not found in source: {path}'
        body = body.replace(path, asset_id)
    template = template[:template.index(marker)] + body

    encoded = json.dumps(template, ensure_ascii=False).replace('</', '<\\u002F')
    bundle = bundle[:m.start(2)] + encoded + bundle[m.end(2):]
    BUNDLE.write_text(bundle, encoding='utf-8')
    print(f'wrote {BUNDLE.relative_to(ROOT)} ({len(bundle.encode())} bytes)')


if __name__ == '__main__':
    main()
