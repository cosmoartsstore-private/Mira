let transitionGen = 0;
let activeAnimations: Animation[] = [];

export async function playTransition(
  destination: string,
  onCovered: () => void
): Promise<void> {
  const cover = document.getElementById("transition-cover");
  if (!cover) {
    onCovered();
    return;
  }

  for (const a of activeAnimations) a.cancel();
  activeAnimations = [];
  const gen = ++transitionGen;

  const label = cover.querySelector(".transition-label") as HTMLElement;
  const content = cover.querySelector(".transition-content") as HTMLElement;

  // Reset
  cover.style.transform = "translateX(100%)";
  cover.style.pointerEvents = "none";
  content.style.opacity = "1";

  label.textContent = `— ${capitalize(destination)} —`;
  cover.style.pointerEvents = "auto";

  try {
    // Phase 1: slide in
    cover.style.transform = "translateX(0%)";
    const slideIn = cover.animate(
      [{ transform: "translateX(100%)" }, { transform: "translateX(0%)" }],
      { duration: 380, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" }
    );
    activeAnimations.push(slideIn);
    await slideIn.finished;
    if (gen !== transitionGen) return;

    // Mount the new page while fully covered
    onCovered();

    // Hold
    await delay(400);
    if (gen !== transitionGen) return;

    // Phase 3: slide out
    const slideOut = cover.animate(
      [{ transform: "translateX(0%)" }, { transform: "translateX(-100%)" }],
      { duration: 380, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" }
    );
    activeAnimations.push(slideOut);

    const skipHandler = (): void => slideOut.finish();
    cover.addEventListener("pointerdown", skipHandler, { once: true });

    await slideOut.finished;
    cover.removeEventListener("pointerdown", skipHandler);
    if (gen !== transitionGen) return;

    // Reset
    activeAnimations = [];
    cover.style.transform = "translateX(100%)";
    cover.style.pointerEvents = "none";
  } catch {
    // Cancelled by new transition
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
