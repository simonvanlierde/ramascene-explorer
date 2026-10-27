# CI and publishing

`.github/workflows/ci.yml` runs ruff, ty, `uv run pytest --cov`,
`brightway-check/table.py --check`, `biome ci`,
`pnpm test` and `pnpm exec playwright test`. None of them needs the engine or
the EXIOBASE matrices, because the engine checks skip without `--engine`.
Both test steps fail below a line-coverage floor: `fail_under` in
`pyproject.toml` for `precompute.py` and `compare_data.py`, and the `test`
script in `package.json` for the JS modules (not the Svelte files).

The page jobs read the synthetic fixtures and the shipped results. CI
downloads `embodied.parquet` from the `data-2011` release and checks it with
`sha256sum --check data/embodied.sha256`. In CI the real-data checks fail
rather than skip when the file is missing. The browser tests run in Chromium
(light, dark and a phone), Firefox, desktop Safari and an iPhone (WebKit),
with axe checking WCAG 2.2 AA.

The pnpm version is pinned once, in `packageManager` in `package.json`; the
workflows' `pnpm/action-setup` steps read it.

`pages.yml` publishes to <https://simonvanlierde.github.io/ramascene-explorer/>
only when started by hand (Actions → pages → Run workflow), and only from
`main`. Before you run it, commit the precompute output. The workflow ships the
bundled page and fonts, the map geometry, `results.json` and `embodied.parquet`
(downloaded from the release and checked against `data/embodied.sha256`), and nothing
else. It stops if `data/results.json` is missing or isn't marked
`data_kind: exiobase-v3`, so the synthetic fixture can never go out.

To check that Pages serves range requests, ask for two bytes. The answer
must be `206`:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-1' https://simonvanlierde.github.io/ramascene-explorer/data/embodied.parquet
```

## Check a release file

`release.yml` attests what a release ships: the `dist` tarball with its
`SHA256SUMS` when a `v*` release is published, and `embodied.parquet` on
`data-2011` when run by hand from `main`. To check a downloaded file:

```sh
gh attestation verify <file> --repo simonvanlierde/ramascene-explorer --signer-workflow simonvanlierde/ramascene-explorer/.github/workflows/release.yml
```

For `embodied.parquet`, add `--source-ref refs/heads/main`. Add
`--bundle <file>.sigstore.json` to check against the downloaded bundle instead
of GitHub's attestation store.

## Tags

Each `v*` tag from v0.4.0 on is signed (`git tag -s`) with an SSH key that
GitHub knows, so the tag shows as Verified on GitHub. To check one locally,
add the maintainer's signing keys (listed at
<https://api.github.com/users/simonvanlierde/ssh_signing_keys>) to the file
`gpg.ssh.allowedSignersFile` names, then run `git verify-tag v0.4.0`.
