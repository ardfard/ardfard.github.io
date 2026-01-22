# ngublag.com

A personal blog built with [Hakyll](https://jaspervdj.be/hakyll/), a static site generator written in Haskell.

## Prerequisites

You need [Nix](https://nixos.org/) installed to set up the development environment.

## Setting Up

Enter the development environment:

```bash
nix-shell
```

This will set up GHC 8.8.3, Cabal, Hakyll, and ghcid.

## Building the Site

```bash
# Build the site executable
cabal build

# Generate the static site
cabal run site build
```

The compiled site will be output to the `_site/` directory.

## Creating a New Blog Post

Blog posts are stored in the `posts/` directory and follow the naming convention:

```
YYYY-MM-DD-post-title.md
```

or

```
YYYY-MM-DD-post-title.markdown
```

### Post Format

Create a new file in `posts/` with YAML frontmatter:

```markdown
---
title: "Your Post Title"
---

Your post content here written in Markdown.
```

After creating a new post, rebuild the site:

```bash
cabal run site build
```

## Development

Watch for changes and rebuild automatically:

```bash
cabal run site watch
```

## Deployment

Deploy to production server (requires `NGUBLAG_PEM_KEY` environment variable):

```bash
./deploy.sh
```

This uses rsync to sync the `_site/` directory to the remote server.

## Project Structure

```
.
├── site.hs              # Main Hakyll configuration
├── ngublag-com.cabal    # Cabal package file
├── shell.nix            # Nix shell configuration
├── posts/               # Blog posts
├── templates/           # HTML templates
├── css/                 # Stylesheets
├── images/              # Images
├── js/                  # JavaScript files
└── _site/               # Generated site (build output)
```
