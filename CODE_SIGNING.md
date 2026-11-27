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

- Shows the [terms of use](TERMS.md), the privacy summary and the MIT license, which must be accepted before installing.
- Installs in `C:\Program Files\Edowave` (Windows asks for administrator permission), with a Start menu shortcut, an optional desktop shortcut and an uninstaller listed in *Settings → Apps*.
- Does **not** start with Windows, does not install other programs and does not change system settings. If Microsoft Edge WebView2 is missing, it only opens Microsoft's official download page.
- Replaces previous per-user installations (up to 1.0.2) and removes their shortcuts, including the old "start with Windows" shortcut.
- The uninstaller removes the app and its shortcuts and offers to delete the user's data.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, except as described in the [privacy policy](PRIVACY.md): the app connects to the music server `musica.empanados.io` to play music and sync the user's account.
