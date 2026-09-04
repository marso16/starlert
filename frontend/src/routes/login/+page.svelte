<script lang="ts">
  import { requestLoginLink } from '$lib/api';

  let email = $state('');
  let status = $state<'idle' | 'sending' | 'sent'>('idle');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    status = 'sending';
    await requestLoginLink(email);
    status = 'sent';
  }
</script>

<main class="login">
  <div class="panel">
    <h1>Sign in</h1>
    {#if status === 'sent'}
      <p class="confirmation">Check your email for a login link.</p>
    {:else}
      <form onsubmit={submit}>
        <label for="email">Work email</label>
        <input id="email" type="email" bind:value={email} required placeholder="owner@yourbusiness.com" />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending...' : 'Send login link'}
        </button>
      </form>
    {/if}
  </div>
</main>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #14171c;
    color: #f2efe9;
    font-family: 'Iowan Old Style', Georgia, serif;
  }

  .panel {
    width: min(360px, 90vw);
    padding: 2.5rem;
    background: #1d2128;
    border: 1px solid #2b313b;
    border-radius: 2px;
  }

  h1 {
    margin: 0 0 1.5rem;
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  label {
    display: block;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9aa3b1;
    margin-bottom: 0.5rem;
  }

  input {
    width: 100%;
    padding: 0.7rem 0.8rem;
    background: #14171c;
    border: 1px solid #2b313b;
    color: #f2efe9;
    font-size: 1rem;
    box-sizing: border-box;
    margin-bottom: 1.25rem;
  }

  button {
    width: 100%;
    padding: 0.75rem;
    background: #d97757;
    color: #14171c;
    border: none;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .confirmation {
    color: #9aa3b1;
  }
</style>
