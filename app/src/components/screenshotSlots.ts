// The Feedback form's screenshot slots (task 088), counted when a pick or a
// paste ARRIVES: attached plus still decoding. The rendered list lags a
// decode (a Retina capture takes hundreds of ms), so two quick pastes read
// from it would both see the last free slot, and one would vanish. Pure, so
// pasteCheck [image paste] can race two pastes for that slot.

/** What a pick or a paste may take. */
export interface SlotClaim {
  /** How many of the offered files to take, first ones first. */
  take: number;
  /** Some were offered and not taken: the form says so. */
  overLimit: boolean;
}

export class ScreenshotSlots {
  private claimed = 0;
  readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /** Claim room for up to `offered` files, now. */
  claim(offered: number): SlotClaim {
    const take = Math.min(offered, Math.max(0, this.max - this.claimed));
    this.claimed += take;
    return { take, overLimit: take < offered };
  }

  /** Give back `n` slots: a failed decode's claim, or a removed screenshot. */
  release(n: number): void {
    this.claimed = Math.max(0, this.claimed - n);
  }

  /** Slots attached or still decoding. */
  get used(): number {
    return this.claimed;
  }
}
