import type { MessageDescriptor, Messages } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { resolveLocale } from "./config.js";
import { loadMessages } from "./loadMessages.js";

export interface VisualEditingToolbarLabels {
	publish: string;
	publishing: string;
	sessionExpired: string;
	refreshPage: string;
	publishFailed: string;
	editMode: string;
	openInAdmin: string;
	hideToolbar: string;
	draft: string;
	published: string;
	unpublishedChanges: string;
	unsaved: string;
	saving: string;
	saved: string;
	saveFailed: string;
	image: string;
	noImageSelected: string;
	altText: string;
	altTextPlaceholder: string;
	replaceImage: string;
	uploadImage: string;
	removeImage: string;
	mediaLibrary: string;
	back: string;
	loading: string;
	noImagesFound: string;
	mediaLoadFailed: string;
	uploadingFile: string;
}

const TOOLBAR_MESSAGES = {
	publish: msg({ id: "visualEditing.publish", message: "Publish" }),
	publishing: msg({ id: "visualEditing.publishing", message: "Publishing…" }),
	sessionExpired: msg({
		id: "visualEditing.sessionExpired",
		message: "Editing session expired. Refresh the page to continue.",
	}),
	refreshPage: msg({ id: "visualEditing.refreshPage", message: "Refresh page" }),
	publishFailed: msg({
		id: "visualEditing.publishFailed",
		message: "Publish failed. Check your permissions and try again.",
	}),
	editMode: msg({ id: "visualEditing.editMode", message: "Edit mode" }),
	openInAdmin: msg({ id: "visualEditing.openInAdmin", message: "Open in admin" }),
	hideToolbar: msg({ id: "visualEditing.hideToolbar", message: "Hide toolbar" }),
	draft: msg({ id: "visualEditing.draft", message: "Draft" }),
	published: msg({ id: "visualEditing.published", message: "Published" }),
	unpublishedChanges: msg({
		id: "visualEditing.unpublishedChanges",
		message: "Unpublished changes",
	}),
	unsaved: msg({ id: "visualEditing.unsaved", message: "Unsaved" }),
	saving: msg({ id: "visualEditing.saving", message: "Saving…" }),
	saved: msg({ id: "visualEditing.saved", message: "Saved" }),
	saveFailed: msg({ id: "visualEditing.saveFailed", message: "Save failed" }),
	image: msg({ id: "visualEditing.image", message: "Image" }),
	noImageSelected: msg({ id: "visualEditing.noImageSelected", message: "No image selected" }),
	altText: msg({ id: "visualEditing.altText", message: "Alt text" }),
	altTextPlaceholder: msg({
		id: "visualEditing.altTextPlaceholder",
		message: "Describe the image",
	}),
	replaceImage: msg({ id: "visualEditing.replaceImage", message: "Replace" }),
	uploadImage: msg({ id: "visualEditing.uploadImage", message: "Upload" }),
	removeImage: msg({ id: "visualEditing.removeImage", message: "Remove" }),
	mediaLibrary: msg({ id: "visualEditing.mediaLibrary", message: "Media Library" }),
	back: msg({ id: "visualEditing.back", message: "Back" }),
	loading: msg({ id: "visualEditing.loading", message: "Loading…" }),
	noImagesFound: msg({ id: "visualEditing.noImagesFound", message: "No images found" }),
	mediaLoadFailed: msg({ id: "visualEditing.mediaLoadFailed", message: "Failed to load media" }),
	uploadingFile: msg({ id: "visualEditing.uploadingFile", message: "Uploading {filename}…" }),
} satisfies Record<keyof VisualEditingToolbarLabels, MessageDescriptor>;

const CENTRAL_ADMIN_MESSAGES = {
	noSiteAccess: msg`No site access`,
	systemAdministration: msg`System administration`,
	sites: msg`Sites`,
	sitesDescription: msg`Manage the sites in this EmDash installation.`,
	registryTitle: msg`Site registry`,
	registryLoadError: msg`Could not load site registry. Try again.`,
	registryLoading: msg`Loading sites…`,
	registryEmpty: msg`No sites are registered yet.`,
	siteCreateTitle: msg`Create a site`,
	siteCreateDescription: msg`Create a site with a separate copy of the default content.`,
	siteCreate: msg`Create site`,
	siteCreating: msg`Creating site…`,
	siteCreateError: msg`Could not create the site. Your entries are preserved. Try again.`,
	siteCreateConflict: msg`That slug or hostname is already in use. Your entries are preserved.`,
	siteCreateSuccess: msg`Site created and ready to serve.`,
	siteCreateTitleLabel: msg`Site title`,
	siteCreateSlugLabel: msg`Site slug`,
	siteTitle: msg`Title`,
	siteSlug: msg`Slug`,
	siteStatus: msg`Registration status`,
	siteDomains: msg`Domains`,
	siteReadiness: msg`Serving readiness`,
	siteReady: msg`Ready`,
	siteUnavailable: msg`Unavailable`,
	siteUnavailableExplanation: msg`This site is registered, but its presentation cannot currently be loaded. Check the installed site build and host logs.`,
	siteDisabledExplanation: msg`This site is disabled. Its registration and data remain, but it is not available to visitors or site administrators.`,
	siteLoadedVersion: msg`Loaded presentation version`,
	siteLatestVersion: msg`Latest presentation version`,
	sitePendingRestart: msg`A restart is needed to load the latest presentation version.`,
	siteActive: msg`Active`,
	siteDisabled: msg`Disabled`,
	siteEditTitle: msg`Edit title`,
	siteSaveTitle: msg`Save title`,
	siteReloadLatest: msg`Reload latest`,
	siteTitleConflict: msg`This title changed elsewhere. Your entry is preserved. Reload the latest title before saving again.`,
	siteSaveError: msg`Could not save the title. Try again.`,
	siteOpenAdmin: msg`Open site admin`,
	siteAdminUnavailableExplanation: msg`Site admin access is not available yet.`,
	siteTitleHelp: msg`A display title only. The site's immutable identity remains its slug and ID.`,
	siteList: msg`All sites`,
	noSitesTitle: msg`No sites yet`,
	noSitesDescription: msg`No sites are registered in this EmDash installation yet.`,
	switchSite: msg`Switch site`,
	loadSitesError: msg`Could not load sites. Try again.`,
	signIn: msg`Sign in to EmDash`,
	noSiteAccessTitle: msg`No site access - EmDash`,
	signInTitle: msg`Sign in - EmDash`,
	noSiteDescription: msg`You are signed in, but you do not have access to a site yet.`,
	signInDescription: msg`Sign in with your staff account to manage sites.`,
	continueToClerk: msg`Continue to Clerk`,
	signInError: msg`Could not load sign-in. Try again.`,
	signOut: msg`Sign out`,
	signOutError: msg`Could not sign out. Try again.`,
};

export function translateCentralAdminLabels(messages: Messages) {
	return {
		noSiteAccess: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.noSiteAccess),
		systemAdministration: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.systemAdministration,
		),
		sites: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.sites),
		sitesDescription: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.sitesDescription),
		registryTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.registryTitle),
		registryLoadError: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.registryLoadError),
		registryLoading: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.registryLoading),
		registryEmpty: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.registryEmpty),
		siteCreateTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteCreateTitle),
		siteCreateDescription: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.siteCreateDescription,
		),
		siteCreate: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteCreate),
		siteCreating: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteCreating),
		siteCreateError: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteCreateError),
		siteCreateConflict: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteCreateConflict),
		siteCreateSuccess: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteCreateSuccess),
		siteCreateTitleLabel: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.siteCreateTitleLabel,
		),
		siteCreateSlugLabel: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.siteCreateSlugLabel,
		),
		siteTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteTitle),
		siteSlug: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteSlug),
		siteStatus: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteStatus),
		siteDomains: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteDomains),
		siteReadiness: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteReadiness),
		siteReady: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteReady),
		siteUnavailable: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteUnavailable),
		siteUnavailableExplanation: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.siteUnavailableExplanation,
		),
		siteDisabledExplanation: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.siteDisabledExplanation,
		),
		siteLoadedVersion: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteLoadedVersion),
		siteLatestVersion: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteLatestVersion),
		sitePendingRestart: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.sitePendingRestart),
		siteActive: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteActive),
		siteDisabled: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteDisabled),
		siteEditTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteEditTitle),
		siteSaveTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteSaveTitle),
		siteReloadLatest: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteReloadLatest),
		siteTitleConflict: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteTitleConflict),
		siteSaveError: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteSaveError),
		siteOpenAdmin: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteOpenAdmin),
		siteAdminUnavailableExplanation: resolveToolbarMessage(
			messages,
			CENTRAL_ADMIN_MESSAGES.siteAdminUnavailableExplanation,
		),
		siteTitleHelp: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteTitleHelp),
		siteList: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.siteList),
		noSitesTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.noSitesTitle),
		noSitesDescription: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.noSitesDescription),
		switchSite: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.switchSite),
		loadSitesError: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.loadSitesError),
		signIn: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.signIn),
		noSiteAccessTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.noSiteAccessTitle),
		signInTitle: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.signInTitle),
		noSiteDescription: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.noSiteDescription),
		signInDescription: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.signInDescription),
		continueToClerk: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.continueToClerk),
		signInError: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.signInError),
		signOut: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.signOut),
		signOutError: resolveToolbarMessage(messages, CENTRAL_ADMIN_MESSAGES.signOutError),
	};
}

function resolveToolbarMessage(messages: Messages, descriptor: MessageDescriptor): string {
	const translated = descriptor.id ? messages[descriptor.id] : undefined;
	if (typeof translated === "string") return translated;
	// Simple {name} placeholders are kept for the toolbar script to fill in.
	if (
		Array.isArray(translated) &&
		translated.every((token) => typeof token === "string" || token.length === 1)
	) {
		return translated
			.map((token) => (typeof token === "string" ? token : `{${token[0]}}`))
			.join("");
	}
	return descriptor.message ?? "";
}

export function translateVisualEditingToolbarLabels(
	messages: Messages,
): VisualEditingToolbarLabels {
	return {
		publish: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.publish),
		publishing: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.publishing),
		sessionExpired: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.sessionExpired),
		refreshPage: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.refreshPage),
		publishFailed: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.publishFailed),
		editMode: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.editMode),
		openInAdmin: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.openInAdmin),
		hideToolbar: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.hideToolbar),
		draft: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.draft),
		published: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.published),
		unpublishedChanges: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.unpublishedChanges),
		unsaved: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.unsaved),
		saving: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.saving),
		saved: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.saved),
		saveFailed: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.saveFailed),
		image: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.image),
		noImageSelected: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.noImageSelected),
		altText: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.altText),
		altTextPlaceholder: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.altTextPlaceholder),
		replaceImage: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.replaceImage),
		uploadImage: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.uploadImage),
		removeImage: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.removeImage),
		mediaLibrary: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.mediaLibrary),
		back: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.back),
		loading: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.loading),
		noImagesFound: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.noImagesFound),
		mediaLoadFailed: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.mediaLoadFailed),
		uploadingFile: resolveToolbarMessage(messages, TOOLBAR_MESSAGES.uploadingFile),
	};
}

export async function loadVisualEditingToolbarLabels(
	request: Request,
): Promise<VisualEditingToolbarLabels> {
	const locale = resolveLocale(request);
	const messages: Messages = await loadMessages(locale);
	return translateVisualEditingToolbarLabels(messages);
}
