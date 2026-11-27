# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## What is signed

Only the Windows app of Edowave and its installer (`Edowave_<version>_x64-setup.exe`, NSIS), built from the source code in this repository by the [GitHub Actions workflow](.github/workflows/pc.yml). Nothing built on a personal computer is signed.

## Team

| Role | Members |
|---|---|
| Authors / committers | [zuih01](https://github.com/zuih01) |
| Reviewers | [zuih01](https://github.com/zuih01) |
| Approvers (approve each signing request) | [zuih01](https://github.com/zuih01) |

All members use multi-factor authentication on GitHub and SignPath.

## Process

1. Every release is tagged (`v1.0.2`, …) in this repository.
2. GitHub Actions builds the app and the installer from that tag.
3. The unsigned build is sent to SignPath and an approver reviews and approves the signing request manually.
4. The signed installer is published on the [GitHub releases](https://github.com/zuih01/edowave/releases) and on the download page.

## What the app does on the system

- Installs for the current user only (no administrator rights), in `%LOCALAPPDATA%\Edowave`, with a Start menu shortcut and an uninstaller.
- After installing it **asks** whether to open Edowave when Windows starts; if accepted, it adds a shortcut to the Startup folder. Uninstalling removes it.
- It does not download or run other programs, does not change system settings and does not modify the registry beyond its own uninstall entry and the `HKCU\Software\Edowave` key.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, except as described in the [privacy policy](PRIVACY.md): the app connects to the music server `musica.empanados.io` to play music and sync the user's account.
