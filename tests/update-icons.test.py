import base64
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
import tarfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'scripts/update-icons.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'


def pack(files, kind='tar'):
    out = io.BytesIO()
    if kind == 'zip':
        with zipfile.ZipFile(out, 'w') as archive:
            for key, data in files.items():
                archive.writestr(key, data)
    else:
        with tarfile.open(fileobj=out, mode='w:gz') as archive:
            for key, data in files.items():
                entry = tarfile.TarInfo(key)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
    return out.getvalue()


class UpdateIcons(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.assets = self.root / 'src/assets'
        (self.assets / 'flags').mkdir(parents=True)
        self.manifest = [
            {'type': 'saas.test', 'provider': 'Simple Icons', 'file': 'test.svg', 'archivePath': 'package/icons/test.svg', 'version': 'Simple Icons 1.0.0', 'sha256': u.digest(SVG)},
            {'type': 'aws.ecs', 'file': 'aws.svg', 'archivePath': 'old/ecs.svg', 'sha256': u.digest(SVG)},
            {'type': 'saas.direct', 'file': 'direct.svg', 'provider': 'Vendor', 'source': 'https://vendor.test', 'downloadURL': 'https://vendor.test/icon.svg', 'sha256': u.digest(SVG)},
            {'type': 'external.user', 'file': 'user.svg', 'provider': 'Infra Canvas', 'sha256': u.digest(SVG)},
        ]
        for entry in self.manifest:
            (self.assets / entry['file']).write_bytes(SVG)
        (self.assets / 'manifest.json').write_text(json.dumps(self.manifest))
        (self.assets / 'flags/manifest.json').write_text(json.dumps({'version': '1.0.0', 'files': [{'country': 'JP', 'file': 'jp.svg'}]}))
        for file in ['SIMPLE-ICONS-LICENSE.txt', 'SIMPLE-ICONS-DISCLAIMER.txt', 'flags/LICENSE.txt', 'flags/jp.svg']:
            (self.assets / file).write_bytes(b'old')
        self.simple = {'package/data/simple-icons.json': json.dumps([{'slug': 'test', 'hex': 'ABCDEF'}]).encode(), 'package/icons/test.svg': SVG, 'package/LICENSE.md': b'license', 'package/DISCLAIMER.md': b'disclaimer'}
        self.responses = {
            u.CLOUDS['aws'][0]: b'<a href="https://d1.awsstatic.com/Icon-package_latest.zip">Icon package</a>',
            'https://d1.awsstatic.com/Icon-package_latest.zip': pack({'new/ecs.svg': SVG}, 'zip'),
            'https://vendor.test/icon.svg': SVG,
        }
        self.set_package('simple-icons', self.simple)
        self.set_package('flag-icons', {'package/flags/4x3/jp.svg': SVG, 'package/LICENSE': b'MIT'})

    def set_package(self, name, files):
        data = pack(files)
        self.responses[f'https://registry.npmjs.org/{name}/latest'] = json.dumps({'version': '2.0.0', 'dist': {'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()}}).encode()
        self.responses[f'https://registry.npmjs.org/{name}/-/{name}-2.0.0.tgz'] = data

    def fetch(self, url):
        return self.responses[url]

    def test_full_update_keeps_shapes_colors_flags_and_is_idempotent(self):
        writes = u.plan(self.root, self.fetch)
        self.assertNotIn(self.assets / 'user.svg', writes)
        colored = writes[self.assets / 'test.svg']
        self.assertEqual(colored.replace(b' fill="#ABCDEF"', b''), SVG)
        manifest = json.loads(writes[self.assets / 'manifest.json'])
        self.assertEqual(manifest[0]['brandColor'], '#ABCDEF')
        self.assertEqual(manifest[1]['archivePath'], 'new/ecs.svg')
        self.assertEqual(writes[self.assets / 'flags/jp.svg'], SVG)
        for path, data in writes.items():
            path.write_bytes(data)
        self.assertEqual(u.plan(self.root, self.fetch), {})

    def test_gcp_core_and_legacy_collections_update_independently(self):
        self.manifest.extend([
            {'type': 'gcp.compute', 'file': 'core.svg', 'archivePath': 'core/compute.svg', 'sha256': u.digest(SVG)},
            {'type': 'gcp.ha-vpn', 'cloudPack': 'gcp-legacy', 'file': 'vpn.svg', 'archivePath': 'cloud_vpn/cloud_vpn.svg', 'sha256': u.digest(SVG)},
        ])
        (self.assets / 'manifest.json').write_text(json.dumps(self.manifest))
        for file in ['core.svg', 'vpn.svg']:
            (self.assets / file).write_bytes(SVG)
        page = u.CLOUDS['gcp'][0]
        core = 'https://services.google.com/core-products-icons.zip'
        legacy = 'https://services.google.com/google-cloud-legacy-icons.zip'
        self.responses[page] = f'<a href="{core}">core</a><a href="{legacy}">legacy</a>'.encode()
        self.responses[core] = pack({'core/compute.svg': SVG}, 'zip')
        self.responses[legacy] = pack({'cloud_vpn/cloud_vpn.svg': SVG}, 'zip')
        writes = u.plan(self.root, self.fetch)
        manifest = json.loads(writes[self.assets / 'manifest.json'])
        self.assertEqual(manifest[-2]['downloadURL'], core)
        self.assertEqual(manifest[-1]['downloadURL'], legacy)
        for path, data in writes.items():
            path.write_bytes(data)
        self.assertEqual(u.plan(self.root, self.fetch), {})

    def test_deleted_brand_aborts_without_touching_any_asset(self):
        before = (self.assets / 'manifest.json').read_bytes()
        self.simple['package/data/simple-icons.json'] = b'[]'
        self.set_package('simple-icons', self.simple)
        with self.assertRaisesRegex(ValueError, '削除'):
            u.plan(self.root, self.fetch)
        self.assertEqual((self.assets / 'manifest.json').read_bytes(), before)
        self.assertEqual((self.assets / 'test.svg').read_bytes(), SVG)

    def test_download_failure_does_not_apply_partial_updates(self):
        self.responses.pop('https://vendor.test/icon.svg')
        with self.assertRaises(KeyError):
            u.plan(self.root, self.fetch)
        self.assertEqual((self.assets / 'test.svg').read_bytes(), SVG)

    def test_integrity_mismatch(self):
        self.responses['https://registry.npmjs.org/simple-icons/-/simple-icons-2.0.0.tgz'] = b'broken'
        with self.assertRaisesRegex(ValueError, 'integrity'):
            u.plan(self.root, self.fetch)

    def test_archive_path_ambiguity(self):
        with self.assertRaisesRegex(ValueError, '曖昧'):
            u.select_file({'one/test.svg': SVG, 'two/test.svg': SVG}, 'old/test.svg')

    def test_reject_active_svg_and_external_references(self):
        for fragment in ['<script/>', '<image href="data:x"/>', '<path onclick="x"/>', '<use href="https://evil.test/x"/>', '<path fill="url(https://evil.test/x)"/>', '<style>@import "https://evil.test/x";</style>']:
            with self.subTest(fragment=fragment), self.assertRaises(ValueError):
                u.validate_svg(SVG.replace(b'<path d="M0 0h24v24H0z"/>', fragment.encode()))

    def test_publish_reuses_branch_and_avoids_identical_updates(self):
        repo = self.root / 'repo'
        remote = self.root / 'remote.git'
        repo.mkdir()
        subprocess.run(['git', 'init', '--bare', str(remote)], check=True, capture_output=True)
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL).decode().strip()
        git('init', '-b', 'main')
        git('config', 'user.name', 'fixture')
        git('config', 'user.email', 'fixture@example.test')
        (repo / 'src/assets').mkdir(parents=True)
        (repo / 'docs').mkdir()
        (repo / 'src/assets/icon.svg').write_bytes(SVG)
        for file in ['assets.md', 'service-icons.md', 'regions.md']:
            (repo / 'docs' / file).write_text('fixture')
        git('add', '.')
        git('commit', '-m', 'initial')
        git('remote', 'add', 'origin', str(remote))
        git('push', 'origin', 'main')
        fake_bin = self.root / 'bin'
        fake_bin.mkdir()
        gh = fake_bin / 'gh'
        gh.write_text('#!/bin/sh\nif [ "$1 $2" = "pr list" ]; then echo "${FIXTURE_PR:-}"; fi\n')
        gh.chmod(0o755)
        script = Path(__file__).resolve().parents[1] / 'scripts/publish-icon-update.sh'
        env = dict(os.environ, PATH=str(fake_bin) + os.pathsep + os.environ['PATH'], GH_TOKEN='fixture', GH_REPO='fixture/repo', BASE_BRANCH='main')
        (repo / 'src/assets/icon.svg').write_bytes(SVG + b'\n')
        subprocess.run(['bash', str(script)], cwd=repo, env=env, check=True, capture_output=True)
        first = git('rev-parse', 'HEAD')
        git('switch', 'main')
        (repo / 'src/assets/icon.svg').write_bytes(SVG + b'\n')
        result = subprocess.run(['bash', str(script)], cwd=repo, env=env, check=True, capture_output=True)
        self.assertIn('同じ内容', result.stdout.decode())
        self.assertEqual(git('ls-remote', 'origin', 'refs/heads/codex/update-icons').split()[0], first)
        (repo / 'src/assets/icon.svg').write_bytes(SVG + b'\n\n')
        env['FIXTURE_PR'] = '7'
        subprocess.run(['bash', str(script)], cwd=repo, env=env, check=True, capture_output=True)
        self.assertNotEqual(git('rev-parse', 'HEAD'), first)

    def test_local_gradients_are_allowed(self):
        u.validate_svg(SVG.replace(b'<path', b'<path fill="url(#gradient)"'))


if __name__ == '__main__':
    unittest.main()
