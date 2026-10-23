---
type: bug
status: corrigé
discovered: 2026-10-23
fixed: 2026-10-23
sources: [frontend/src/components/StockOriginDrawer.tsx, frontend/src/components/BocalTimelineDrawer.tsx]
---

# Bug — Drawers plein écran décalés de 24 px (marge `space-y-*` du parent)

**Découvert le 2026-10-23** par Pik sur l'APK, juste après l'ajout des boutons Modifier / Supprimer en bas de `StockOriginDrawer` (v3.13.0).

## Symptôme

Sur la page Stock, le panneau « Origine du stock » laissait voir le haut du header de l'appli au-dessus de lui, et sa barre de boutons du bas était coupée par la barre de navigation Android.

## Cause

Le drawer (`fixed top-0 h-full`) était rendu comme enfant direct du conteneur `space-y-6` de la page. `space-y-6` ajoute `margin-top: 1.5rem` à chaque enfant sauf le premier, y compris aux éléments `fixed` : le panneau descendait de 24 px tout en gardant 100 % de hauteur, donc ses 24 derniers px sortaient de l'écran. Même problème latent sur `BocalTimelineDrawer` (SechageCuring), et sur PC (moins visible).

## Correctif

Les deux drawers sont rendus via `createPortal(..., document.body)` : ils ne dépendent plus du layout de la page. Règle ajoutée dans [[frontend/conventions]].
