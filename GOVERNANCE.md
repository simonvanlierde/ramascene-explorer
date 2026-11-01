# Governance

RaMa-Scene Explorer has one maintainer: Simon van Lierde
([@simonvanlierde](https://github.com/simonvanlierde)).

## How decisions are made

- The maintainer decides what goes in, reviews and merges every pull request
  (only he has write access), and tags releases.
- Anyone can propose a change in an issue or pull request
  ([CONTRIBUTING.md](CONTRIBUTING.md)). The maintainer says yes, asks for
  changes, or says no with a reason.
- The maintainer enforces the [code of conduct](CODE_OF_CONDUCT.md).

## If the maintainer is unavailable

A successor can take over the GitHub repository and publish it with their own Cloudflare
account ([publishing.md](docs/publishing.md#cloudflare)). Any static host that answers byte
ranges also serves it; without the isolation headers it computes on one thread.
The release workflow uses GitHub's own token.
The static site needs no separate calculation server.
Zenodo ownership and any custom domain need a separate transfer.

The code, the release history and the docs are public under the MIT license,
so anyone can also fork the project.
