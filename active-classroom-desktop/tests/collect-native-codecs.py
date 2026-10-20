#!/usr/bin/env python3
"""Run inside a clean distro container. Do not copy its GTK/media framework."""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

output = pathlib.Path(sys.argv[1])
subprocess.run(['apt-get', 'update'], check=True)
subprocess.run(['apt-get', 'install', '-y', '--no-install-recommends', 'libwebkit2gtk-4.1-0'], check=True)
roots = [pathlib.Path('/usr/lib/x86_64-linux-gnu'), pathlib.Path('/lib/x86_64-linux-gnu')]
baseline = {path.name for root in roots for path in root.rglob('*.so*')}
subprocess.run(['apt-get', 'install', '-y', '--no-install-recommends',
                'gstreamer1.0-plugins-base', 'gstreamer1.0-plugins-good',
                'gstreamer1.0-plugins-bad', 'gstreamer1.0-libav', 'gstreamer1.0-gl'], check=True)
plugins = pathlib.Path('/usr/lib/x86_64-linux-gnu/gstreamer-1.0')
names = ['coreelements', 'app', 'playback', 'typefindfunctions', 'audioconvert',
         'audioresample', 'videoconvert', 'videoscale', 'videoconvertscale', 'volume',
         'autodetect', 'pulseaudio', 'isomp4', 'audioparsers', 'videoparsersbad',
         'libav', 'va', 'opengl', 'wavparse', 'wavpack', 'ogg', 'vorbis', 'opus', 'flac',
         'mpg123', 'id3demux', 'apetag', 'matroska']
required = {'libgstapp.so', 'libgstplayback.so', 'libgstisomp4.so',
            'libgstvideoparsersbad.so', 'libgstlibav.so', 'libgstopengl.so'}
core = re.compile(r'^(?:lib(?:glib|gobject|gio|gmodule|gthread|gtk|gdk|webkit|javascriptcore|gstreamer)-|libgst(?:base|app|audio|video|gl|tag|pbutils|allocators|riff|fft|net|controller)-)')
output.mkdir(parents=True, exist_ok=True)
(output / 'plugins').mkdir()
(output / 'lib').mkdir()
copied = set()
owners = set()
def remember_owner(path):
    result = subprocess.run(['dpkg-query', '-S', str(path.resolve())], capture_output=True, text=True)
    for line in result.stdout.splitlines():
        owner = line.split(': ')[0]
        if re.fullmatch(r'[a-z0-9+.-]+(?::[a-z0-9]+)?', owner):
            owners.add(owner)
for name in names:
    path = plugins / ('libgst' + name + '.so')
    if not path.is_file():
        continue
    destination = output / 'plugins' / name / path.name
    destination.parent.mkdir()
    shutil.copyfile(path, destination)
    remember_owner(path)
    copied.add(path.name)
    dependencies = subprocess.run(['ldd', str(path)], check=True, capture_output=True, text=True).stdout
    if 'not found' in dependencies:
        raise RuntimeError('Missing codec dependency: ' + path.name)
    if 'libsoup-2.4' in dependencies:
        raise RuntimeError('Codec cannot load libsoup2 into the WebKitGTK libsoup3 process')
    for soname, target in re.findall(r'^\s*(\S+)\s+=>\s+(/\S+)', dependencies, re.MULTILINE):
        if soname in baseline:
            continue
        if core.match(soname):
            raise RuntimeError('Attempt to package a second media framework: ' + soname)
        destination = output / 'lib' / soname
        if not destination.exists():
            shutil.copyfile(target, destination)
            remember_owner(pathlib.Path(target))
if not required.issubset(copied):
    raise RuntimeError('Required media plugins absent: ' + str(required - copied))
version = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'libgstreamer1.0-0'], text=True).split(':')[-1].split('-')[0]
(output / 'gstreamer-version').write_text(version + '\n', encoding='utf8')
manifest = []
for path in sorted([*output.glob('lib/*.so*'), *output.glob('plugins/*/*.so')]):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(65536), b''):
            digest.update(block)
    path.chmod(0o644)
    manifest.append({'path': str(path.relative_to(output)), 'size': path.stat().st_size, 'sha256': digest.hexdigest()})
(output / 'licenses').mkdir()
packages = []
for owner in sorted(owners):
    copyright_file = pathlib.Path('/usr/share/doc') / owner.split(':')[0] / 'copyright'
    if copyright_file.is_file():
        shutil.copyfile(copyright_file, output / 'licenses' / (owner.replace(':', '_') + '.copyright'))
    source = subprocess.check_output(['dpkg-query', '-W', '-f=${source:Package} ${source:Version}', owner], text=True)
    packages.append({'package': owner, 'source': source})
(output / 'integrity.json').write_text(json.dumps({'gstreamer': version, 'packages': packages, 'files': manifest}, indent=2) + '\n', encoding='utf8')
print('NATIVE_CODECS framework_copied=false plugins=' + str(len(copied)) + ' gstreamer=' + version)
