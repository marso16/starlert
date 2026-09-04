export function playAlertSound(): void {
  const audio = new Audio('/alert.mp3');
  void audio.play().catch(() => {
    // Autoplay can be blocked until the user interacts with the page once; not fatal.
  });
}
