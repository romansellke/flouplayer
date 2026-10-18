# Versioning and releases

## Version numbers

Flou Player uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** (0.4.1): bug fixes only.
- **MINOR** (0.5.0): new features or visible changes, backwards compatible.
- **MAJOR** (1.0.0): reserved for a stable, declared-complete release. Until
  then the version stays at `0.x`, and minor releases may still change
  behaviour.

The version lives in exactly one place: `__version__` in
`app/__init__.py`. Don't edit it by hand -- `packaging/release.sh` does it.

## Where the version shows up

- **About dialog** (info button, top right): the version, the build ID (a
  fingerprint of the code and UI files, used to detect an outdated running
  instance), the source (`git describe` plus commit date -- for example
  `v0.4.0-3-g75367ef-dirty` means three commits after v0.4.0 with local
  changes), the Python/system/dependency versions and a link to the changelog.
- **Diagnostics → Copy report**: the same version, build and source, for bug
  reports.
- The installed app carries the source info from build time
  (`app/_buildinfo.json`, written by `packaging/build.sh`, not tracked by
  git). When running from a source checkout the info comes from git.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/): add
every user-visible change under `## [Unreleased]` in the section **Added**,
**Changed**, **Deprecated**, **Removed**, **Fixed** or **Security** as part of
the pull request that makes it.

## Making a release

1. Make sure everything for the release is merged into `main` and you are on
   `main`, up to date, with a clean working tree.
2. In `CHANGELOG.md`, rename the `## [Unreleased]` entries to
   `## [X.Y.Z] - YYYY-MM-DD`, leave an empty `## [Unreleased]` above, and
   update the link lines at the bottom.
3. Run `./packaging/release.sh X.Y.Z`. It checks the version format, the
   clean tree and the changelog section, sets `__version__`, commits
   "Release vX.Y.Z" and creates the annotated tag `vX.Y.Z`.
4. Publish: `git push origin HEAD vX.Y.Z`. Optionally create a GitHub
   release from the tag, using the changelog section as release notes.
5. Users update with `git pull` and `./packaging/install.sh --rebuild`.
