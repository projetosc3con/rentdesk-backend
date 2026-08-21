import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/__tests__/helpers/setupEnv.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/controllers/asaasWebhookController.ts',
        'src/controllers/bankReconciliationController.ts',
        'src/controllers/billController.ts',
        'src/controllers/paymentController.ts',
        'src/controllers/fiscalController.ts',
        'src/controllers/clientController.ts',
        'src/services/asaasService.ts',
        'src/services/bbAuthService.ts',
        'src/services/bbExtratoService.ts',
        'src/services/bbPixService.ts',
        'src/services/emailService.ts',
        'src/utils/billNormalizers.ts',
      ],
    },
  },
});
