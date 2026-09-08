import type { LicenseProvider } from '@n8n/backend-common';
import { Logger } from '@n8n/backend-common';
import { GlobalConfig } from '@n8n/config';
import {
	DEFAULT_WORKFLOW_HISTORY_PRUNE_LIMIT,
	LICENSE_FEATURES,
	LICENSE_QUOTAS,
	Time,
	UNLIMITED_LICENSE_QUOTA,
	type BooleanLicenseFeature,
	type NumericLicenseFeature,
} from '@n8n/constants';
import { SettingsRepository } from '@n8n/db';
import { OnLeaderStepdown, OnLeaderTakeover, OnPubSubEvent, OnShutdown } from '@n8n/decorators';
import { Container, Service } from '@n8n/di';
import type { TEntitlement, TLicenseBlock } from '@n8n_io/license-sdk';
import { LicenseManager } from '@n8n_io/license-sdk';
import { InstanceSettings } from 'n8n-core';

import { LicenseMetricsService } from '@/metrics/license-metrics.service';

import { N8N_VERSION, SETTINGS_LICENSE_CERT_KEY } from './constants';

const LICENSE_RENEWAL_DISABLED_WARNING =
	'Automatic license renewal is disabled. The license will not renew automatically, and access to licensed features may be lost!';

/** The license server rejects device fingerprints shorter than this. */
const MIN_DEVICE_FINGERPRINT_LENGTH = 32;

export type FeatureReturnType = Partial<
	{
		planName: string;
	} & { [K in NumericLicenseFeature]: number } & { [K in BooleanLicenseFeature]: boolean }
>;

type LicenseRefreshCallback = (cert: string) => void;

@Service()
export class License implements LicenseProvider {
	private manager: LicenseManager | undefined;

	private isShuttingDown = false;

	private refreshCallbacks: LicenseRefreshCallback[] = [];

	private hasWarnedShortDeviceFingerprint = false;

	constructor(
		private readonly logger: Logger,
		private readonly instanceSettings: InstanceSettings,
		private readonly settingsRepository: SettingsRepository,
		private readonly licenseMetricsService: LicenseMetricsService,
		private readonly globalConfig: GlobalConfig,
	) {
		this.logger = this.logger.scoped('license');
	}

	async init({
		forceRecreate = false,
		isCli = false,
	}: { forceRecreate?: boolean; isCli?: boolean } = {}) {
		this.logger.info('License manager initialized (offline bypass)');
	}

	/**
	 * `instanceId` can be pinned to an arbitrary value via `N8N_INSTANCE_ID` or
	 * the `instance.id` deployment-key row, but the license server rejects
	 * fingerprints shorter than 32 characters. Fall back to the
	 * encryption-key-derived id — the fingerprint every instance used before
	 * pinning existed — so activation and renewal keep working.
	 */
	private deviceFingerprint(): string {
		const { instanceId, derivedInstanceId } = this.instanceSettings;
		if (instanceId.length >= MIN_DEVICE_FINGERPRINT_LENGTH) return instanceId;

		if (!this.hasWarnedShortDeviceFingerprint) {
			this.hasWarnedShortDeviceFingerprint = true;
			this.logger.warn(
				`Instance ID is shorter than ${MIN_DEVICE_FINGERPRINT_LENGTH} characters, so it cannot be used as the license device fingerprint. Falling back to the encryption-key-derived ID. Check the N8N_INSTANCE_ID env var and the 'instance.id' deployment key.`,
			);
		}

		return derivedInstanceId;
	}

	async loadCertStr(): Promise<TLicenseBlock> {
		// if we have an ephemeral license, we don't want to load it from the database
		const ephemeralLicense = this.globalConfig.license.cert;
		if (ephemeralLicense) {
			return ephemeralLicense;
		}
		const databaseSettings = await this.settingsRepository.findOne({
			where: {
				key: SETTINGS_LICENSE_CERT_KEY,
			},
		});

		return databaseSettings?.value ?? '';
	}

	private async onFeatureChange() {
		void this.broadcastReloadLicenseCommand();
		await this.notifyRefreshCallbacks();
	}

	private async onLicenseRenewed() {
		void this.broadcastReloadLicenseCommand();
		await this.notifyRefreshCallbacks();
	}

	private async broadcastReloadLicenseCommand() {
		if (this.globalConfig.executions.mode === 'queue' && this.instanceSettings.isLeader) {
			const { Publisher } = await import('@/scaling/pubsub/publisher.service.js');
			await Container.get(Publisher).publishCommand({ command: 'reload-license' });
		}
	}

	async saveCertStr(value: TLicenseBlock): Promise<void> {
		// if we have an ephemeral license, we don't want to save it to the database
		if (this.globalConfig.license.cert) return;
		await this.settingsRepository.upsert(
			{
				key: SETTINGS_LICENSE_CERT_KEY,
				value,
				loadOnStartup: false,
			},
			['key'],
		);
	}

	/**
	 * Register a callback to be notified when license certificate is refreshed.
	 * Returns an unsubscribe function.
	 */
	onCertRefresh(refreshCallback: LicenseRefreshCallback): () => void {
		this.refreshCallbacks.push(refreshCallback);
		return () => {
			const index = this.refreshCallbacks.indexOf(refreshCallback);
			if (index > -1) {
				this.refreshCallbacks.splice(index, 1);
			}
		};
	}

	private async notifyRefreshCallbacks(): Promise<void> {
		const cert = await this.loadCertStr();
		for (const refreshCallback of this.refreshCallbacks) {
			try {
				refreshCallback(cert);
			} catch (error) {
				this.logger.error('Error in license refresh callback', { error });
			}
		}
	}

	async activate(activationKey: string): Promise<void>;
	async activate(activationKey: string, eulaUri: string, userEmail: string): Promise<void>;
	async activate(activationKey: string, _eulaUri?: string, _userEmail?: string): Promise<void> {
		this.logger.debug('License activated (offline bypass)');
	}

	@OnPubSubEvent('reload-license')
	async reload(): Promise<void> {
		await this.notifyRefreshCallbacks();
		this.logger.debug('License reloaded (offline bypass)');
	}

	async renew() {
		this.logger.debug('License renewed (offline bypass)');
	}

	async clear() {
		this.logger.info('License cleared (offline bypass)');
	}

	@OnShutdown()
	async shutdown() {
		this.isShuttingDown = true;
		this.logger.debug('License shut down');
	}

	isLicensed(feature: BooleanLicenseFeature) {
		if (feature === LICENSE_FEATURES.API_DISABLED) return false;
		if (feature === LICENSE_FEATURES.SHOW_NON_PROD_BANNER) return false;
		return true;
	}

	isCertValid(): boolean {
		return true;
	}

	hasFeatureInCert(feature: BooleanLicenseFeature): boolean {
		return this.isLicensed(feature);
	}

	/** @deprecated Use `LicenseState.isDynamicCredentialsLicensed` instead. */
	isDynamicCredentialsEnabled() {
		return this.isLicensed(LICENSE_FEATURES.DYNAMIC_CREDENTIALS);
	}

	/** @deprecated Use `LicenseState.isSharingLicensed` instead. */
	isSharingEnabled() {
		return this.isLicensed(LICENSE_FEATURES.SHARING);
	}

	/** @deprecated Use `LicenseState.isLogStreamingLicensed` instead. */
	isLogStreamingEnabled() {
		return this.isLicensed(LICENSE_FEATURES.LOG_STREAMING);
	}

	/** @deprecated Use `LicenseState.isLdapLicensed` instead. */
	isLdapEnabled() {
		return this.isLicensed(LICENSE_FEATURES.LDAP);
	}

	/** @deprecated Use `LicenseState.isSamlLicensed` instead. */
	isSamlEnabled() {
		return this.isLicensed(LICENSE_FEATURES.SAML);
	}

	/** @deprecated Use `LicenseState.isAiAssistantLicensed` instead. */
	isAiAssistantEnabled() {
		return this.isLicensed(LICENSE_FEATURES.AI_ASSISTANT);
	}

	/** @deprecated Use `LicenseState.isAskAiLicensed` instead. */
	isAskAiEnabled() {
		return this.isLicensed(LICENSE_FEATURES.ASK_AI);
	}

	/** @deprecated Use `LicenseState.isAiCreditsLicensed` instead. */
	isAiCreditsEnabled() {
		return this.isLicensed(LICENSE_FEATURES.AI_CREDITS);
	}

	/** @deprecated Use `LicenseState.isAdvancedExecutionFiltersLicensed` instead. */
	isAdvancedExecutionFiltersEnabled() {
		return this.isLicensed(LICENSE_FEATURES.ADVANCED_EXECUTION_FILTERS);
	}

	/** @deprecated Use `LicenseState.isAdvancedPermissionsLicensed` instead. */
	isAdvancedPermissionsLicensed() {
		return this.isLicensed(LICENSE_FEATURES.ADVANCED_PERMISSIONS);
	}

	/** @deprecated Use `LicenseState.isDebugInEditorLicensed` instead. */
	isDebugInEditorLicensed() {
		return this.isLicensed(LICENSE_FEATURES.DEBUG_IN_EDITOR);
	}

	/** @deprecated Use `LicenseState.isBinaryDataS3Licensed` instead. */
	isBinaryDataS3Licensed() {
		return this.isLicensed(LICENSE_FEATURES.BINARY_DATA_S3);
	}

	/** @deprecated Use `LicenseState.isMultiMainLicensed` instead. */
	isMultiMainLicensed() {
		return this.isLicensed(LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES);
	}

	/** @deprecated Use `LicenseState.isVariablesLicensed` instead. */
	isVariablesEnabled() {
		return this.isLicensed(LICENSE_FEATURES.VARIABLES);
	}

	/** @deprecated Use `LicenseState.isSourceControlLicensed` instead. */
	isSourceControlLicensed() {
		return this.isLicensed(LICENSE_FEATURES.SOURCE_CONTROL);
	}

	/** @deprecated Use `LicenseState.isExternalSecretsLicensed` instead. */
	isExternalSecretsEnabled() {
		return this.isLicensed(LICENSE_FEATURES.EXTERNAL_SECRETS);
	}

	/** @deprecated Use `LicenseState.isAPIDisabled` instead. */
	isAPIDisabled() {
		return this.isLicensed(LICENSE_FEATURES.API_DISABLED);
	}

	/** @deprecated Use `LicenseState.isWorkerViewLicensed` instead. */
	isWorkerViewLicensed() {
		return this.isLicensed(LICENSE_FEATURES.WORKER_VIEW);
	}

	/** @deprecated Use `LicenseState.isProjectRoleAdminLicensed` instead. */
	isProjectRoleAdminLicensed() {
		return this.isLicensed(LICENSE_FEATURES.PROJECT_ROLE_ADMIN);
	}

	/** @deprecated Use `LicenseState.isProjectRoleEditorLicensed` instead. */
	isProjectRoleEditorLicensed() {
		return this.isLicensed(LICENSE_FEATURES.PROJECT_ROLE_EDITOR);
	}

	/** @deprecated Use `LicenseState.isProjectRoleViewerLicensed` instead. */
	isProjectRoleViewerLicensed() {
		return this.isLicensed(LICENSE_FEATURES.PROJECT_ROLE_VIEWER);
	}

	/** @deprecated Use `LicenseState.isCustomNpmRegistryLicensed` instead. */
	isCustomNpmRegistryEnabled() {
		return this.isLicensed(LICENSE_FEATURES.COMMUNITY_NODES_CUSTOM_REGISTRY);
	}

	/** @deprecated Use `LicenseState.isFoldersLicensed` instead. */
	isFoldersEnabled() {
		return this.isLicensed(LICENSE_FEATURES.FOLDERS);
	}

	getCurrentEntitlements(): TEntitlement[] {
		const mainPlan = this.getMainPlan();
		return mainPlan ? [mainPlan] : [];
	}

	getValue<T extends keyof FeatureReturnType>(feature: T): FeatureReturnType[T] {
		if (feature === 'planName') {
			return 'Enterprise' as FeatureReturnType[T];
		}
		if (feature === LICENSE_QUOTAS.AI_CREDITS || feature === LICENSE_QUOTAS.AI_GATEWAY_BUDGET) {
			return 999999 as FeatureReturnType[T];
		}
		if (feature === LICENSE_QUOTAS.WORKFLOW_HISTORY_PRUNE_LIMIT) {
			return UNLIMITED_LICENSE_QUOTA as FeatureReturnType[T];
		}
		if (Object.values(LICENSE_QUOTAS).includes(feature as NumericLicenseFeature)) {
			return UNLIMITED_LICENSE_QUOTA as FeatureReturnType[T];
		}
		if (Object.values(LICENSE_FEATURES).includes(feature as BooleanLicenseFeature)) {
			return this.isLicensed(feature as BooleanLicenseFeature) as FeatureReturnType[T];
		}
		return undefined as FeatureReturnType[T];
	}

	getManagementJwt(): string {
		return '';
	}

	/**
	 * Helper function to get the latest main plan for a license
	 */
	getMainPlan(): TEntitlement | undefined {
		return {
			id: 'mock-enterprise-plan',
			productId: 'enterprise',
			name: 'Enterprise Plan',
			validFrom: new Date('2020-01-01'),
			validTo: new Date('2099-12-31'),
			productMetadata: { terms: { isMainPlan: true } },
		} as unknown as TEntitlement;
	}

	getConsumerId() {
		return 'internal';
	}

	// Helper functions for computed data

	/** @deprecated Use `LicenseState` instead. */
	getUsersLimit() {
		return UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getTriggerLimit() {
		return UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getVariablesLimit() {
		return UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getAiCredits() {
		return 999999;
	}

	/** @deprecated Use `LicenseState` instead. */
	getWorkflowHistoryPruneLimit() {
		return UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getTeamProjectLimit() {
		return UNLIMITED_LICENSE_QUOTA;
	}

	getPlanName(): string {
		return 'Enterprise';
	}

	getExpiryDate(): Date | null {
		return new Date('2099-12-31');
	}

	getTerminationDate(): Date | null {
		return new Date('2099-12-31');
	}

	getExpiringInDays(): number | undefined {
		return undefined;
	}

	getTerminatingInDays(): number | undefined {
		return undefined;
	}

	getInfo(): string {
		return 'Plan: Enterprise (Offline Bypass)';
	}

	/** @deprecated Use `LicenseState` instead. */
	isWithinUsersLimit() {
		return true;
	}

	@OnLeaderTakeover()
	enableAutoRenewals() {
		this.manager?.enableAutoRenewals();
	}

	@OnLeaderStepdown()
	disableAutoRenewals() {
		this.manager?.disableAutoRenewals();
	}

	private onExpirySoon() {
		this.logger.info('License is about to expire soon, reloading license...');

		// reload in background to avoid blocking SDK

		void this.reload()
			.then(() => {
				this.logger.info('Reloaded license on expiry soon');
			})
			.catch((error) => {
				this.logger.error('Failed to reload license on expiry soon', {
					error: error instanceof Error ? error.message : error,
				});
			});
	}
}
