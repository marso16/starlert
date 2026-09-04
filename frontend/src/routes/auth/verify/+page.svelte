<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { verifyLoginToken } from '$lib/api';

  let status = $state<'checking' | 'failed'>('checking');

  onMount(async () => {
    const token = $page.url.searchParams.get('token');
    if (!token) {
      status = 'failed';
      return;
    }
    const ok = await verifyLoginToken(token);
    if (ok) {
      goto('/dashboard');
    } else {
      status = 'failed';
    }
  });
</script>

<main class="verify">
  {#if status === 'checking'}
    <p>Signing you in...</p>
  {:else}
    <p>That link is invalid or expired. <a href="/login">Request a new one</a>.</p>
  {/if}
</main>

<style>
  .verify {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #14171c;
    color: #f2efe9;
    font-family: 'Iowan Old Style', Georgia, serif;
  }
</style>
