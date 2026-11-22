import type { Dictionary } from './en'

/** French dictionary. Same keys as en.ts (the type fails the build if one is missing or extra). */
export const fr: Dictionary = {
  // Navigation
  'nav.main': 'Navigation principale',
  'nav.mobile': 'Navigation mobile',
  'nav.dashboard': 'Tableau de bord',
  'nav.coach': 'Coach IA',
  'nav.plan': "Plan d'entraînement",
  'nav.activities': 'Activités',
  'nav.routes': 'Parcours',
  'nav.nutrition': 'Nutrition',
  'nav.settings': 'Réglages',
  'nav.signOut': 'Se déconnecter',
  'nav.home': 'Accueil',
  'nav.coachShort': 'Coach',
  'nav.planShort': 'Plan',
  'nav.openMenu': 'Ouvrir le menu',

  // Login
  'login.tagline': 'Votre coach sportif propulsé par l’IA',
  'login.authFailed': 'La connexion a échoué. Veuillez réessayer.',
  'login.notAllowed':
    "Ce compte n'est pas sur la liste d'accès de SportAI. Contactez le propriétaire si vous pensez qu'il s'agit d'une erreur.",
  'login.google': 'Continuer avec Google',
  'login.googleAria': 'Se connecter avec Google',
  'login.agreePrefix': 'En vous connectant, vous acceptez nos',
  'login.terms': 'Conditions',
  'login.and': 'et notre',
  'login.privacy': 'Politique de confidentialité',

  // Settings
  'settings.title': 'Réglages',
  'settings.subtitle': 'Connectez vos sources de données et gérez vos préférences.',
  'settings.integrations': 'Intégrations',
  'settings.location': 'Lieu',
  'settings.preferences': 'Préférences',
  'settings.language': 'Langue',
  'settings.languageHelp':
    "Utilisée pour l'application, les réponses du coach et les plans générés. Les messages et plans existants gardent la langue dans laquelle ils ont été écrits.",
  'settings.voiceEngine': 'Saisie vocale',
  'settings.voiceWhisper': 'Transcription par le serveur (détecte votre langue)',
  'settings.voiceBrowser': 'Reconnaissance vocale du navigateur (utilise la langue choisie)',
  'settings.voiceHelp':
    "La transcription par le serveur fonctionne dans tous les navigateurs et détecte la langue que vous parlez. La reconnaissance vocale du navigateur est instantanée, mais elle exige la langue définie ci-dessus, peut envoyer l'audio à l'éditeur du navigateur et n'est pas disponible partout. Dans les deux cas, vous pouvez modifier le texte avant de l'utiliser.",
  'settings.languageError': "Impossible d'enregistrer la langue. Réessayez.",

  // Coach / chat
  'coach.title': 'Coach IA',
  'coach.chats': 'Discussions',
  'coach.newChat': 'Nouvelle discussion',
  'coach.noChats': 'Aucune discussion pour le moment.',
  'coach.loading': 'Chargement…',
  'coach.askTitle': 'Posez une question à votre coach IA',
  'coach.askSubtitle': 'Il connaît vos activités, votre charge d’entraînement et votre objectif.',
  'coach.suggestion1': 'Comment était ma dernière sortie ?',
  'coach.suggestion2': "Que devrais-je faire aujourd'hui ?",
  'coach.suggestion3': 'Suis-je prêt pour une séance difficile ?',
  'coach.suggestion4': 'Comment évolue ma charge d’entraînement ?',
  'coach.placeholder': 'Posez une question à votre coach, ou touchez le micro…',
  'coach.send': 'Envoyer',
  'coach.typing': 'Le coach écrit',
  'coach.readAloudOn': 'Désactiver la lecture à voix haute',
  'coach.readAloudOff': 'Activer la lecture à voix haute',
  'coach.readAloudOnTitle': 'Lecture à voix haute activée',
  'coach.readAloudOffTitle': 'Lecture à voix haute désactivée',
  'coach.chatOpened': 'Discussion ouverte.',
  'coach.newChatStarted': 'Nouvelle discussion démarrée.',
  'coach.newChatFailed': 'Impossible de démarrer une nouvelle discussion.',
  'coach.summarizing': 'Résumé de la discussion en cours…',
  'coach.deleting': 'Suppression de la discussion…',
  'coach.deleteFailed': 'Impossible de supprimer la discussion.',
  'coach.keepFailedStatus':
    "Impossible de conserver un résumé. La discussion n'a pas été supprimée. {message}",
  'coach.keepFailed':
    "{message} La discussion n'a pas été supprimée. Vous pouvez réessayer ou choisir Tout supprimer.",
  'coach.deletedWithSummary': 'Discussion supprimée. Un résumé a été ajouté aux notes conservées.',
  'coach.deleted': 'Discussion supprimée.',
  'coach.loadFailed': 'Impossible de charger vos discussions. Rechargez la page pour réessayer.',
  'coach.newChatReload':
    'Impossible de démarrer une nouvelle discussion. Rechargez la page pour réessayer.',
  'coach.noResponse': '⚠️ Pas de réponse. Réessayez.',
  'coach.requestFailed': 'La requête a échoué',
  'coach.networkError': 'Erreur réseau',
  'coach.deleteChatAria': 'Supprimer la discussion {title}',
  'coach.confirmDeleteAria': 'Confirmer la suppression de la discussion {title}',
  'coach.deleteExplain':
    'Cette discussion sera supprimée et ne pourra pas être restaurée. Conserver un court résumé pour que le coach retienne les points clés ?',
  'coach.deleteKeep': 'Supprimer et garder un résumé',
  'coach.deleteAll': 'Tout supprimer',
  'coach.summarizingShort': 'Résumé…',
  'coach.deletingShort': 'Suppression…',
  'common.cancel': 'Annuler',

  // Kept notes
  'notes.title': 'Notes conservées',
  'notes.help':
    "Le coach lit ces notes dans les nouvelles discussions. Modifiez ou supprimez toute note que vous ne voulez plus qu'il utilise.",
  'notes.empty': 'Aucune note conservée pour le moment.',
  'notes.editAria': 'Modifier la note {title}',
  'notes.deleteAria': 'Supprimer la note {title}',
  'notes.confirmDeleteAria': 'Confirmer la suppression de la note {title}',
  'notes.confirmDelete': 'Supprimer cette note ? Le coach l’oubliera.',
  'notes.save': 'Enregistrer',
  'notes.edit': 'Modifier',
  'notes.delete': 'Supprimer',
  'notes.deleteNote': 'Supprimer la note',
  'notes.keep': 'Garder',
  'notes.saveFailed': "Impossible d'enregistrer la note.",
  'notes.deleteFailed': 'Impossible de supprimer la note.',
  'notes.saved': 'Note enregistrée.',
  'notes.deleted': 'Note supprimée.',

  // Voice
  'voice.stop': "Arrêter l'enregistrement",
  'voice.record': 'Enregistrer la voix',
  'voice.unsupported': "L'enregistrement n'est pas pris en charge par ce navigateur",
  'voice.permissionDenied': 'Accès au microphone refusé',
  'voice.startFailed': "Impossible de démarrer l'enregistrement",
}
