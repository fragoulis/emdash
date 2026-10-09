import { Clerk } from "@clerk/clerk-js";
import { Button, LinkButton } from "@cloudflare/kumo";
import { useEffect, useState } from "react";

interface Props {
	noAccess: boolean;
	signInUrl: string;
	title: string;
	description: string;
	continueLabel: string;
	signOutLabel: string;
	signOutError: string;
}

export function AdminAccess({
	noAccess,
	signInUrl,
	title,
	description,
	continueLabel,
	signOutLabel,
	signOutError,
}: Props) {
	const [clerk, setClerk] = useState<Clerk | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		const key = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
		if (!key) return;
		const client = new Clerk(key);
		void (async () => {
			try {
				await client.load();
				if (!noAccess && client.user) {
					window.location.replace("/_emdash/admin/no-access");
				} else {
					setClerk(client);
				}
			} catch {
				setError(true);
			}
		})();
	}, [noAccess]);

	return (
		<main className="min-h-screen bg-kumo-canvas text-kumo-default flex items-center justify-center p-6">
			<section className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-8 shadow-sm">
				<p className="text-kumo-brand font-semibold mb-5">EmDash</p>
				<h1 className="text-2xl font-semibold mb-3">{title}</h1>
				<p className="text-kumo-subtle mb-6">{description}</p>
				{noAccess ? (
					<>
						<Button
							onClick={async () => {
								try {
									const response = await fetch("/_emdash/api/auth/logout", {
										method: "POST",
										headers: { "X-EmDash-Request": "1" },
									});
									if (!response.ok) throw new Error("Logout failed");
									await clerk?.signOut().catch(() => {});
									window.location.replace("/_emdash/admin/login");
								} catch {
									setError(true);
								}
							}}
						>
							{signOutLabel}
						</Button>
						{error && (
							<p role="alert" className="text-kumo-danger mt-4">
								{signOutError}
							</p>
						)}
					</>
				) : (
					<LinkButton href={signInUrl}>{continueLabel}</LinkButton>
				)}
			</section>
		</main>
	);
}
