<script lang="ts">
import { goto } from '$app/navigation';
import { onMount } from 'svelte';

// Redirect to login page with register mode
onMount(() => {
	goto('/login');
});
</script>

<div class="min-h-screen bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] flex items-center justify-center px-4 py-10">
	<div class="text-center text-white">
		<p>Redirigiendo...</p>
	</div>
</div>
