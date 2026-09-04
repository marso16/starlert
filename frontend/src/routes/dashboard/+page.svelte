<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchAlerts, fetchGoogleStatus, type ReviewAlert, type GoogleConnectionStatus } from '$lib/api';
  import { startPresenceHeartbeat } from '$lib/presence';
  import { subscribeToAlerts } from '$lib/sse';
  import { playAlertSound } from '$lib/sound';

  let alerts = $state<ReviewAlert[]>([]);
  let loading = $state(true);
  let googleStatus = $state<GoogleConnectionStatus>('connected');

  let stopHeartbeat: () => void;
  let closeStream: () => void;

  onMount(async () => {
    const [initialAlerts, status] = await Promise.all([fetchAlerts(), fetchGoogleStatus()]);
    alerts = initialAlerts;
    googleStatus = status;
    loading = false;

    stopHeartbeat = startPresenceHeartbeat();
    closeStream = subscribeToAlerts((incoming) => {
      alerts = [incoming, ...alerts];
      playAlertSound();
    });
  });

  onDestroy(() => {
    stopHeartbeat?.();
    closeStream?.();
  });
</script>

<main class="dashboard">
  <header>
    <h1>Reviews needing attention</h1>
  </header>

  {#if googleStatus !== 'connected'}
    <p class="banner">
      Your Google Business Profile connection needs attention.
      <a href="/api/google/connect">Reconnect Google</a>
    </p>
  {/if}

  {#if loading}
    <p class="empty">Loading...</p>
  {:else if alerts.length === 0}
    <p class="empty">No low-rated reviews yet. You will hear a sound the moment one comes in.</p>
  {:else}
    <ul class="alerts">
      {#each alerts as alert (alert.id)}
        <li class="alert">
          <div class="rating" data-rating={alert.rating}>{alert.rating}</div>
          <div class="content">
            <p class="author">{alert.author ?? 'A customer'}</p>
            <p class="text">{alert.text ?? '(no comment left)'}</p>
            <p class="time">{new Date(alert.reviewTime).toLocaleString()}</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .dashboard {
    min-height: 100vh;
    background: #f4f1ea;
    color: #14171c;
    font-family: 'Iowan Old Style', Georgia, serif;
    padding: 3rem clamp(1rem, 5vw, 4rem);
  }

  header h1 {
    font-size: 1.75rem;
    font-weight: 500;
    margin-bottom: 2rem;
  }

  .empty {
    color: #6b7280;
  }

  .banner {
    margin: 0 0 1.5rem;
    padding: 0.85rem 1.1rem;
    background: #f0e4c8;
    border: 1px solid #d8c393;
    color: #5c4a1f;
  }

  .banner a {
    color: #5c4a1f;
    font-weight: 600;
  }

  .alerts {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: #d8d2c4;
    border: 1px solid #d8d2c4;
  }

  .alert {
    display: flex;
    gap: 1.25rem;
    padding: 1.25rem 1.5rem;
    background: #fbfaf6;
  }

  .rating {
    flex: none;
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #b4443a;
    color: #fbfaf6;
    font-weight: 600;
  }

  .content {
    flex: 1;
  }

  .author {
    margin: 0 0 0.25rem;
    font-weight: 600;
  }

  .text {
    margin: 0 0 0.5rem;
    color: #3f3a33;
  }

  .time {
    margin: 0;
    font-size: 0.8rem;
    color: #8a8371;
  }
</style>
