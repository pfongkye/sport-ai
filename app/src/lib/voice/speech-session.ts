/**
 * Collects Web Speech results and resolves the transcript when recognition ends.
 * Browsers can end a session on their own (silence, network error). In that case the text
 * is handed to `onUnpromptedEnd` instead of being lost.
 */
export class SpeechSession {
  private text = ''
  private resolver: ((text: string) => void) | null = null
  ended = false

  constructor(private onUnpromptedEnd: (text: string) => void) {}

  addFinal(transcript: string) {
    this.text += `${transcript} `
  }

  /** Call from `onend`. */
  handleEnd() {
    this.ended = true
    const text = this.text.trim()
    if (this.resolver) {
      const r = this.resolver
      this.resolver = null
      r(text)
    } else {
      this.onUnpromptedEnd(text)
    }
  }

  /** Resolves with the transcript once `requestStop` has caused recognition to end. */
  stop(requestStop: () => void): Promise<string> {
    if (this.ended) return Promise.resolve(this.text.trim())
    return new Promise((resolve) => {
      this.resolver = resolve
      requestStop()
    })
  }
}
