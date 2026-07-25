/**
 * Asset action feature entry point.
 *
 * The implementation remains available at its legacy lib path while callers
 * migrate. New feature code should import through this boundary so executor
 * transport can move without coupling UI components to generic utilities.
 */
export * from '../../lib/editPipeline';

