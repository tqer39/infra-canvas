"""公式配布物を収集し、全件の検証後に同梱アイコンへ適用する（外部依存なし）。"""
import argparse
import copy
import hashlib
import html
import io
import json
import re
import subprocess
import tarfile
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

CLOUDS = {
    'gcp-legacy': ('https://cloud.google.com/icons', r'https://services\.google\.com/[^"<>\s]*google-cloud-legacy-icons\.zip'),
    'aws': ('https://aws.amazon.com/architecture/icons/', r'https://d1\.awsstatic\.com/[^"<>\s]*Icon-package[^"<>\s]*\.zip'),
    'gcp': ('https://cloud.google.com/icons', r'https://services\.google\.com/[^"<>\s]*core-products-icons\.zip'),
    'azure': ('https://learn.microsoft.com/en-us/azure/architecture/icons/', r'https://arch-center\.azureedge\.net/[^"<>\s]*\.zip'),
}
MAX_FILE = 5 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def download(url):
    if not url.startswith('https://'):
        raise ValueError('HTTPS が必要: ' + url)
    return subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location',
                                   '--proto', '=https', '--proto-redir', '=https',
                                   '--max-time', '120', '--retry', '2', url])


def archive_files(data, kind):
    result = {}
    if kind == 'zip':
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for item in archive.infolist():
                if not item.is_dir() and item.file_size <= MAX_FILE:
                    if item.filename in result:
                        raise ValueError('重複パス: ' + item.filename)
                    result[item.filename] = archive.read(item)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            for item in archive:
                if item.isfile() and item.size <= MAX_FILE:
                    if item.name in result:
                        raise ValueError('重複パス: ' + item.name)
                    result[item.name] = archive.extractfile(item).read()
    return result


def select_file(files, old_path):
    if old_path in files:
        return old_path, files[old_path]
    # 配布物の版付きディレクトリ変更だけを許容。サービス名は推測しない。
    matches = [key for key in files if Path(key).name == Path(old_path).name and '__MACOSX' not in key]
    if len(matches) != 1:
        raise ValueError('配布パスが見つからない、または曖昧: ' + old_path)
    return matches[0], files[matches[0]]


def validate_svg(data):
    if len(data) > MAX_FILE or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('SVG サイズまたは XML 宣言が不正')
    root = ET.fromstring(data)
    if root.tag != '{http://www.w3.org/2000/svg}svg':
        raise ValueError('SVG ではない')
    for element in root.iter():
        tag = element.tag.split('}')[-1].lower()
        if tag in {'script', 'foreignobject', 'image', 'iframe', 'a', 'animate', 'set'}:
            raise ValueError('禁止 SVG 要素: ' + tag)
        if tag == 'style' and re.search(r'@import|expression\(|url\(\s*[\"\']?(?:https?:|//|data:)', element.text or '', re.I):
            raise ValueError('外部 CSS または実行コード')
        for key, value in element.attrib.items():
            key = key.split('}')[-1].lower()
            if key.startswith('on') or (key == 'href' and not value.startswith('#')):
                raise ValueError('実行コードまたは外部参照')
            if any(not target.strip(" \"'").startswith('#') for target in re.findall(r'url\(([^)]*)\)', value, re.I)):
                raise ValueError('外部 CSS 参照')
    return data


def color_svg(data, color):
    if not re.fullmatch(r'#[0-9A-F]{6}', color):
        raise ValueError('ブランドカラーが不正')
    validate_svg(data)
    text = data.decode('utf-8')
    if not text.startswith('<svg ') or re.search(r'<svg[^>]*\sfill=', text):
        raise ValueError('Simple Icons SVG の形式が変わりました')
    return text.replace('<svg ', '<svg fill="' + color + '" ', 1).encode()


def npm_package(name, fetch):
    metadata = json.loads(fetch('https://registry.npmjs.org/' + name + '/latest'))
    version = metadata['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('安定版以外の npm パッケージ')
    url = f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
    data = fetch(url)
    import base64
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if integrity != metadata['dist']['integrity']:
        raise ValueError('npm 配布物の integrity 不一致')
    return version, url, digest(data), archive_files(data, 'tar')


def plan(root, fetch=download):
    assets = root / 'src/assets'
    manifest = json.loads((assets / 'manifest.json').read_text())
    flags = json.loads((assets / 'flags/manifest.json').read_text())
    updated = copy.deepcopy(manifest)
    writes = {}
    cache = {}
    today = date.today().isoformat()
    def get(url):
        if url not in cache:
            cache[url] = fetch(url)
        return cache[url]
    simple = [entry for entry in updated if entry.get('provider') == 'Simple Icons']
    if simple:
        version, url, archive_hash, files = npm_package('simple-icons', get)
        colors = json.loads(files['package/data/simple-icons.json'])
        for entry in simple:
            slug = Path(entry['archivePath']).stem
            candidates = [item for item in colors if item.get('slug') == slug]
            if len(candidates) != 1:
                raise ValueError('最新版から削除されたブランド: ' + slug)
            original = files[entry['archivePath']]
            color = '#' + candidates[0]['hex'].upper()
            data = color_svg(original, color)
            if entry['version'] != 'Simple Icons ' + version or entry['sha256'] != digest(data) or entry.get('archiveSha256') != archive_hash:
                entry.update(version='Simple Icons ' + version, downloadURL=url, archiveSha256=archive_hash,
                             originalSha256=digest(original), brandColor=color, sha256=digest(data),
                             retrievedAt=today, colorSource=f'https://github.com/simple-icons/simple-icons/blob/{version}/data/simple-icons.json')
            writes[assets / entry['file']] = data
        writes[assets / 'SIMPLE-ICONS-LICENSE.txt'] = files['package/LICENSE.md']
        writes[assets / 'SIMPLE-ICONS-DISCLAIMER.txt'] = files['package/DISCLAIMER.md']
    cloud_archives = {}
    for entry in updated:
        provider = entry.get('cloudPack', entry['type'].split('.')[0])
        if provider in CLOUDS:
            if provider not in cloud_archives:
                page, pattern = CLOUDS[provider]
                links = sorted(set(re.findall(pattern, html.unescape(get(page).decode()))))
                if len(links) != 1:
                    raise ValueError('公式 ZIP リンクが見つからない、または曖昧: ' + provider)
                blob = get(links[0])
                cloud_archives[provider] = (page, links[0], digest(blob), archive_files(blob, 'zip'))
            page, url, archive_hash, files = cloud_archives[provider]
            archive_path, data = select_file(files, entry['archivePath'])
        elif entry.get('provider') not in {'Simple Icons', 'Infra Canvas'}:
            url = entry['downloadURL']
            blob = get(url)
            page = entry['source']
            archive_hash = digest(blob)
            archive_path = entry.get('archivePath')
            if archive_path:
                archive_path, data = select_file(archive_files(blob, 'zip'), archive_path)
            else:
                data = blob
        else:
            continue
        validate_svg(data)
        if entry.get('archiveSha256') != archive_hash or entry['sha256'] != digest(data):
            entry.update(source=page, downloadURL=url, sha256=digest(data), retrievedAt=today,
                         version='配布物 SHA-256 ' + archive_hash, archiveSha256=archive_hash)
            if archive_path:
                entry['archivePath'] = archive_path
        writes[assets / entry['file']] = data
    version, url, archive_hash, files = npm_package('flag-icons', get)
    for entry in flags['files']:
        data = validate_svg(files['package/flags/4x3/' + entry['file']])
        entry['sha256'] = digest(data)
        writes[assets / 'flags' / entry['file']] = data
    flags.update(version=version, download=url, archiveSHA256=archive_hash)
    writes[assets / 'flags/LICENSE.txt'] = files['package/LICENSE']
    writes[assets / 'flags/manifest.json'] = (json.dumps(flags, ensure_ascii=False, indent=2) + '\n').encode()
    writes[assets / 'manifest.json'] = (json.dumps(updated, ensure_ascii=False, indent=2) + '\n').encode()
    return {path: data for path, data in writes.items() if path.read_bytes() != data}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='取得・検証し、書き込まず差分一覧を表示')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    writes = plan(root)
    print('\n'.join(str(path.relative_to(root)) for path in writes) or '更新なし')
    if not args.check:
        for path, data in writes.items():
            path.write_bytes(data)


if __name__ == '__main__':
    main()
