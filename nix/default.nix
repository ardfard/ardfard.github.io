{ sources ? import ./sources.nix
}:
let 
  overlay = self: super: {
    hp = super.haskell.packages.ghc883;
  };

  unpackSymlinks = hp: pkgs.haskell.lib.overrideCabal hp (drv: {
    postUnpack = ''
      cp --remove-destination ${./README.md} $sourceRoot/README.md
      cp --remove-destination ${./LICENSE} $sourceRoot/LICENSE
    '';
  });

  pkgs = import sources.nixpkgs {
    overlays = [overlay];
  };

  gitignoreSource = (import sources."gitignore.nix" { inherit (pkgs) lib; }).gitignoreSource;
  src = gitignoreSource ./..;
  drv = pkgs.hp.callCabal2nix "ngublag-com" src {};
  shell = pkgs.hp.shellFor {
    packages = p: [drv];
    buildInputs = with pkgs; [
      hp.hakyll
      hp.cabal-install
      hp.ghcid
    ];
  };
in 
  { inherit shell; }
