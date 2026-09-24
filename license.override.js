"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.License = void 0;
const backend_common_1 = require("@n8n/backend-common");
const config_1 = require("@n8n/config");
const constants_1 = require("@n8n/constants");
const db_1 = require("@n8n/db");
const decorators_1 = require("@n8n/decorators");
const di_1 = require("@n8n/di");
const n8n_core_1 = require("n8n-core");
const license_metrics_service_1 = require("./metrics/license-metrics.service");
const constants_2 = require("./constants");

let License = class License {
    constructor(logger, instanceSettings, settingsRepository, licenseMetricsService, globalConfig) {
        this.logger = logger;
        this.instanceSettings = instanceSettings;
        this.settingsRepository = settingsRepository;
        this.licenseMetricsService = licenseMetricsService;
        this.globalConfig = globalConfig;
        this.isShuttingDown = false;
        this.refreshCallbacks = [];
        this.hasWarnedShortDeviceFingerprint = false;
        this.logger = this.logger.scoped('license');
    }
    async init({ forceRecreate = false, isCli = false, } = {}) {
        this.logger.info('License manager initialized');
    }
    deviceFingerprint() {
        const { instanceId, derivedInstanceId } = this.instanceSettings;
        if (instanceId.length >= 32) return instanceId;
        return derivedInstanceId;
    }
    async loadCertStr() {
        return '';
    }
    async saveCertStr(value) {
    }
    onCertRefresh(refreshCallback) {
        this.refreshCallbacks.push(refreshCallback);
        return () => {
            const index = this.refreshCallbacks.indexOf(refreshCallback);
            if (index > -1) {
                this.refreshCallbacks.splice(index, 1);
            }
        };
    }
    async notifyRefreshCallbacks() {
        const cert = await this.loadCertStr();
        for (const refreshCallback of this.refreshCallbacks) {
            try {
                refreshCallback(cert);
            }
            catch (error) {
                this.logger.error('Error in license refresh callback', { error });
            }
        }
    }
    async activate(activationKey, eulaUri, userEmail) {
        this.logger.debug('License activated');
    }
    async reload() {
        await this.notifyRefreshCallbacks();
        this.logger.debug('License reloaded');
    }
    async renew() {
        this.logger.debug('License renewed');
    }
    async clear() {
        this.logger.info('License cleared');
    }
    async shutdown() {
        this.isShuttingDown = true;
        this.logger.debug('License shut down');
    }
    isLicensed(feature) {
        if (feature === constants_1.LICENSE_FEATURES.API_DISABLED) return false;
        if (feature === constants_1.LICENSE_FEATURES.SHOW_NON_PROD_BANNER) return false;
        return true;
    }
    isCertValid() {
        return true;
    }
    hasFeatureInCert(feature) {
        return this.isLicensed(feature);
    }
    isDynamicCredentialsEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.DYNAMIC_CREDENTIALS);
    }
    isSharingEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.SHARING);
    }
    isLogStreamingEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.LOG_STREAMING);
    }
    isLdapEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.LDAP);
    }
    isSamlEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.SAML);
    }
    isAiAssistantEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.AI_ASSISTANT);
    }
    isAskAiEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.ASK_AI);
    }
    isAiCreditsEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.AI_CREDITS);
    }
    isAdvancedExecutionFiltersEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.ADVANCED_EXECUTION_FILTERS);
    }
    isAdvancedPermissionsLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.ADVANCED_PERMISSIONS);
    }
    isDebugInEditorLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.DEBUG_IN_EDITOR);
    }
    isBinaryDataS3Licensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.BINARY_DATA_S3);
    }
    isMultiMainLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES);
    }
    isVariablesEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.VARIABLES);
    }
    isSourceControlLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.SOURCE_CONTROL);
    }
    isExternalSecretsEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.EXTERNAL_SECRETS);
    }
    isAPIDisabled() {
        return false;
    }
    isWorkerViewLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.WORKER_VIEW);
    }
    isProjectRoleAdminLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.PROJECT_ROLE_ADMIN);
    }
    isProjectRoleEditorLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.PROJECT_ROLE_EDITOR);
    }
    isProjectRoleViewerLicensed() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.PROJECT_ROLE_VIEWER);
    }
    isCustomNpmRegistryEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.COMMUNITY_NODES_CUSTOM_REGISTRY);
    }
    isFoldersEnabled() {
        return this.isLicensed(constants_1.LICENSE_FEATURES.FOLDERS);
    }
    getCurrentEntitlements() {
        const mainPlan = this.getMainPlan();
        return mainPlan ? [mainPlan] : [];
    }
    getValue(feature) {
        if (feature === 'planName') {
            return 'Enterprise';
        }
        if (feature === constants_1.LICENSE_QUOTAS.AI_CREDITS || feature === constants_1.LICENSE_QUOTAS.AI_GATEWAY_BUDGET) {
            return 999999;
        }
        if (feature === constants_1.LICENSE_QUOTAS.WORKFLOW_HISTORY_PRUNE_LIMIT) {
            return constants_1.UNLIMITED_LICENSE_QUOTA;
        }
        if (Object.values(constants_1.LICENSE_QUOTAS).includes(feature)) {
            return constants_1.UNLIMITED_LICENSE_QUOTA;
        }
        if (Object.values(constants_1.LICENSE_FEATURES).includes(feature)) {
            return this.isLicensed(feature);
        }
        return undefined;
    }
    getManagementJwt() {
        return '';
    }
    getMainPlan() {
        return {
            id: 'enterprise-plan',
            productId: 'enterprise',
            name: 'Enterprise Plan',
            validFrom: new Date('2020-01-01'),
            validTo: new Date('2099-12-31'),
            productMetadata: { terms: { isMainPlan: true } },
        };
    }
    getConsumerId() {
        return 'internal';
    }
    getUsersLimit() {
        return constants_1.UNLIMITED_LICENSE_QUOTA;
    }
    getTriggerLimit() {
        return constants_1.UNLIMITED_LICENSE_QUOTA;
    }
    getVariablesLimit() {
        return constants_1.UNLIMITED_LICENSE_QUOTA;
    }
    getAiCredits() {
        return 999999;
    }
    getWorkflowHistoryPruneLimit() {
        return constants_1.UNLIMITED_LICENSE_QUOTA;
    }
    getTeamProjectLimit() {
        return constants_1.UNLIMITED_LICENSE_QUOTA;
    }
    getPlanName() {
        return 'Enterprise';
    }
    getExpiryDate() {
        return new Date('2099-12-31');
    }
    getTerminationDate() {
        return new Date('2099-12-31');
    }
    getExpiringInDays() {
        return undefined;
    }
    getTerminatingInDays() {
        return undefined;
    }
    getInfo() {
        return 'Plan: Enterprise';
    }
    isWithinUsersLimit() {
        return true;
    }
    enableAutoRenewals() {
    }
    disableAutoRenewals() {
    }
    onExpirySoon() {
    }
};
exports.License = License;
__decorate([
    (0, decorators_1.OnPubSubEvent)('reload-license'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], License.prototype, "reload", null);
__decorate([
    (0, decorators_1.OnShutdown)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], License.prototype, "shutdown", null);
__decorate([
    (0, decorators_1.OnLeaderTakeover)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], License.prototype, "enableAutoRenewals", null);
__decorate([
    (0, decorators_1.OnLeaderStepdown)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], License.prototype, "disableAutoRenewals", null);
exports.License = License = __decorate([
    (0, di_1.Service)(),
    __metadata("design:paramtypes", [backend_common_1.Logger, n8n_core_1.InstanceSettings, db_1.SettingsRepository, license_metrics_service_1.LicenseMetricsService, config_1.GlobalConfig])
], License);
