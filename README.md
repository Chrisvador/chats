# Mes chats

Application web installable (iPhone, iPad, ordinateur) pour les chats du foyer : fiche complète, photos, pesées, traitements (vermifuge, antipuces, vaccins, médicaments) avec rappels par notification, et stocks de croquettes et pâtée avec date de rupture estimée.

Données et photos dans Supabase (projet `mes-chats` : tables `foyers`, `foyer_membres`, `chats`, `pesees`, `chat_photos`, `traitements`, `prises`, `produits`, `mouvements`, `push_abonnements`, stockage privé `chats`). Tout est partagé entre les membres d'un foyer (invitation par code). Les rappels sont envoyés chaque heure par la fonction `rappels` (dossier `supabase/functions`).
