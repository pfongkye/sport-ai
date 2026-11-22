/**
 * English dictionary: the source of truth for keys. `fr.ts` must define the same keys
 * (enforced by the `Dictionary` type and by dictionaries.test.ts).
 * Placeholders use {name}.
 */
export const en = {
  // Navigation
  'nav.main': 'Main navigation',
  'nav.mobile': 'Mobile navigation',
  'nav.dashboard': 'Dashboard',
  'nav.coach': 'AI Coach',
  'nav.plan': 'Training Plan',
  'nav.activities': 'Activities',
  'nav.routes': 'Routes',
  'nav.nutrition': 'Nutrition',
  'nav.settings': 'Settings',
  'nav.signOut': 'Sign out',
  'nav.home': 'Home',
  'nav.coachShort': 'Coach',
  'nav.planShort': 'Plan',
  'nav.openMenu': 'Open menu',

  // Login
  'login.tagline': 'Your AI-powered athletic coach',
  'login.authFailed': 'Sign-in failed. Please try again.',
  'login.notAllowed':
    "This account isn't on the access list for SportAI. Contact the owner if you think this is a mistake.",
  'login.google': 'Continue with Google',
  'login.googleAria': 'Sign in with Google',
  'login.agreePrefix': 'By signing in, you agree to our',
  'login.terms': 'Terms',
  'login.and': 'and',
  'login.privacy': 'Privacy Policy',

  // Settings
  'settings.title': 'Settings',
  'settings.subtitle': 'Connect data sources and manage your preferences.',
  'settings.integrations': 'Integrations',
  'settings.location': 'Location',
  'settings.preferences': 'Preferences',
  'settings.language': 'Language',
  'settings.languageHelp':
    'Used for the app, the coach replies and generated plans. Existing messages and plans keep the language they were written in.',
  'settings.voiceEngine': 'Voice input',
  'settings.voiceWhisper': 'Server transcription (detects your language)',
  'settings.voiceBrowser': 'Browser speech recognition (uses your language setting)',
  'settings.voiceHelp':
    'Server transcription works in every browser and detects the language you speak. Browser speech recognition is live, but it needs the language set above, may send audio to the browser vendor, and is not available everywhere. Either way you can edit the text before using it.',
  'settings.languageError': 'Could not save the language. Try again.',

  // Coach / chat
  'coach.title': 'AI Coach',
  'coach.chats': 'Chats',
  'coach.newChat': 'New chat',
  'coach.noChats': 'No chats yet.',
  'coach.loading': 'Loading…',
  'coach.askTitle': 'Ask your AI coach',
  'coach.askSubtitle': 'It knows your activities, training load, and goal.',
  'coach.suggestion1': 'How was my last run?',
  'coach.suggestion2': 'What should I do today?',
  'coach.suggestion3': 'Am I ready for a hard session?',
  'coach.suggestion4': 'How is my training load trending?',
  'coach.placeholder': 'Ask your coach, or tap the mic…',
  'coach.send': 'Send',
  'coach.typing': 'Coach is typing',
  'coach.readAloudOn': 'Disable read-aloud',
  'coach.readAloudOff': 'Enable read-aloud',
  'coach.readAloudOnTitle': 'Read-aloud on',
  'coach.readAloudOffTitle': 'Read-aloud off',
  'coach.chatOpened': 'Chat opened.',
  'coach.newChatStarted': 'New chat started.',
  'coach.newChatFailed': 'Could not start a new chat.',
  'coach.summarizing': 'Summarizing the chat…',
  'coach.deleting': 'Deleting the chat…',
  'coach.deleteFailed': 'Could not delete the chat.',
  'coach.keepFailedStatus': 'Could not keep a summary. The chat was not deleted. {message}',
  'coach.keepFailed': '{message} The chat was not deleted. You can try again or choose Delete everything.',
  'coach.deletedWithSummary': 'Chat deleted. A summary was added to Kept notes.',
  'coach.deleted': 'Chat deleted.',
  'coach.loadFailed': 'Could not load your chats. Reload the page to try again.',
  'coach.newChatReload': 'Could not start a new chat. Reload the page to try again.',
  'coach.noResponse': '⚠️ No response. Try again.',
  'coach.requestFailed': 'Request failed',
  'coach.networkError': 'Network error',
  'coach.deleteChatAria': 'Delete chat {title}',
  'coach.confirmDeleteAria': 'Confirm deleting chat {title}',
  'coach.deleteExplain':
    'This chat will be deleted and cannot be restored. Keep a short summary so the coach remembers the key points?',
  'coach.deleteKeep': 'Delete and keep summary',
  'coach.deleteAll': 'Delete everything',
  'coach.summarizingShort': 'Summarizing…',
  'coach.deletingShort': 'Deleting…',
  'common.cancel': 'Cancel',

  // Kept notes
  'notes.title': 'Kept notes',
  'notes.help': 'The coach reads these notes in new chats. Edit or delete any note you no longer want it to use.',
  'notes.empty': 'No kept notes yet.',
  'notes.editAria': 'Edit note {title}',
  'notes.deleteAria': 'Delete note {title}',
  'notes.confirmDeleteAria': 'Confirm deleting note {title}',
  'notes.confirmDelete': 'Delete this note? The coach will forget it.',
  'notes.save': 'Save',
  'notes.edit': 'Edit',
  'notes.delete': 'Delete',
  'notes.deleteNote': 'Delete note',
  'notes.keep': 'Keep',
  'notes.saveFailed': 'Could not save the note.',
  'notes.deleteFailed': 'Could not delete the note.',
  'notes.saved': 'Note saved.',
  'notes.deleted': 'Note deleted.',

  // Voice
  'voice.stop': 'Stop recording',
  'voice.record': 'Record voice',
  'voice.unsupported': 'Recording not supported in this browser',
  'voice.permissionDenied': 'Microphone permission denied',
  'voice.startFailed': 'Could not start recording',
} as const

export type DictKey = keyof typeof en
export type Dictionary = Record<DictKey, string>
