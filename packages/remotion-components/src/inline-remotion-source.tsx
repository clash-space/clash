import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as Remotion from 'remotion';
import ts from 'typescript';

const INLINE_SOURCE_FILE = 'InlineRemotionComponent.tsx';
const ALLOWED_SOURCE_IMPORTS = new Set(['react', 'remotion']);
const MAX_COMPILED_SOURCE_CACHE_SIZE = 32;

export type InlineRemotionComponentProps = Record<string, unknown>;
export type InlineRemotionComponent = React.ComponentType<InlineRemotionComponentProps>;

export type RemotionSourceCompositionProps = {
  source: string;
  componentId?: string;
  componentProps?: InlineRemotionComponentProps;
};

export class InlineRemotionSourceError extends Error {
  readonly phase: 'compile' | 'evaluate';

  constructor(phase: 'compile' | 'evaluate', message: string) {
    super(`Inline Remotion source ${phase} failed: ${message}`);
    this.name = 'InlineRemotionSourceError';
    this.phase = phase;
  }
}

const compiledSourceCache = new Map<string, InlineRemotionComponent>();

function sourceError(phase: 'compile' | 'evaluate', error: unknown): InlineRemotionSourceError {
  if (error instanceof InlineRemotionSourceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new InlineRemotionSourceError(phase, message);
}

function assertAllowedSourceImport(specifier: string): void {
  if (ALLOWED_SOURCE_IMPORTS.has(specifier)) return;
  throw new InlineRemotionSourceError(
    'compile',
    `Inline TSX may only import from "react" or "remotion"; received "${specifier}".`,
  );
}

function validateSourceImports(sourceFile: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        assertAllowedSourceImport(node.moduleSpecifier.text);
      }
    }

    if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      assertAllowedSourceImport(node.moduleReference.expression.text);
    }

    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
        assertAllowedSourceImport(argument.literal.text);
      }
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        throw new InlineRemotionSourceError(
          'compile',
          'Dynamic imports are not supported in inline Remotion TSX.',
        );
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        throw new InlineRemotionSourceError(
          'compile',
          'require() is not supported in inline Remotion TSX.',
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${position.line + 1}:${position.character + 1} ${message}`;
}

function transpileInlineSource(source: string): string {
  const sourceFile = ts.createSourceFile(
    INLINE_SOURCE_FILE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  validateSourceImports(sourceFile);

  const output = ts.transpileModule(source, {
    fileName: INLINE_SOURCE_FILE,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      isolatedModules: true,
      sourceMap: false,
      inlineSourceMap: false,
    },
  });
  const errors = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new InlineRemotionSourceError('compile', errors.map(diagnosticMessage).join('\n'));
  }
  return output.outputText;
}

function requireInlineModule(specifier: string): unknown {
  if (specifier === 'react') return React;
  if (specifier === 'react/jsx-runtime') return ReactJsxRuntime;
  if (specifier === 'remotion') return Remotion;
  throw new InlineRemotionSourceError(
    'evaluate',
    `Generated module requested unsupported import "${specifier}".`,
  );
}

function isReactComponent(value: unknown): value is InlineRemotionComponent {
  if (typeof value === 'function') return true;
  return typeof value === 'object' && value !== null && '$$typeof' in value;
}

function evaluateInlineSource(source: string): InlineRemotionComponent {
  const output = transpileInlineSource(source);
  const inlineModule: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const evaluate = new Function(
      'require',
      'module',
      'exports',
      `${output}\n//# sourceURL=clash-inline-remotion-component.js`,
    ) as (
      requireModule: (specifier: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;
    evaluate(requireInlineModule, inlineModule, inlineModule.exports);
  } catch (error) {
    throw sourceError('evaluate', error);
  }

  const component = inlineModule.exports.default;
  if (!isReactComponent(component)) {
    throw new InlineRemotionSourceError(
      'evaluate',
      'The inline TSX module must have a default export containing a React component.',
    );
  }
  return component;
}

function cacheCompiledSource(source: string, component: InlineRemotionComponent): void {
  if (compiledSourceCache.size >= MAX_COMPILED_SOURCE_CACHE_SIZE) {
    const oldestSource = compiledSourceCache.keys().next().value;
    if (typeof oldestSource === 'string') compiledSourceCache.delete(oldestSource);
  }
  compiledSourceCache.set(source, component);
}

export function compileInlineRemotionSource(source: string): InlineRemotionComponent {
  const cached = compiledSourceCache.get(source);
  if (cached) return cached;
  const component = evaluateInlineSource(source);
  cacheCompiledSource(source, component);
  return component;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function InlineRemotionErrorDisplay({
  componentId,
  error,
  phase,
}: {
  componentId?: string;
  error: unknown;
  phase: 'compile' | 'runtime';
}) {
  return (
    <div
      role="alert"
      data-inline-remotion-error={phase}
      data-remotion-component-id={componentId}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
        overflow: 'hidden',
        color: '#fecaca',
        background: '#450a0a',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <strong>
        Inline Remotion {phase} error{componentId ? ` (${componentId})` : ''}
      </strong>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {errorMessage(error)}
      </pre>
    </div>
  );
}

class InlineRemotionRuntimeErrorBoundary extends React.Component<
  { children: React.ReactNode; componentId?: string },
  { error: unknown | null }
> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error !== null) {
      return (
        <InlineRemotionErrorDisplay
          componentId={this.props.componentId}
          phase="runtime"
          error={this.state.error}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Shared component host for both a Canvas Remotion Player and the product
 * VideoComposition. Pass this component to <Player> with source/componentProps
 * as inputProps, or mount it directly inside a Timeline sequence.
 */
export function RemotionSourceComposition({
  source,
  componentId,
  componentProps = {},
}: RemotionSourceCompositionProps) {
  let Component: InlineRemotionComponent;
  try {
    Component = compileInlineRemotionSource(source);
  } catch (error) {
    return (
      <InlineRemotionErrorDisplay
        componentId={componentId}
        phase="compile"
        error={error}
      />
    );
  }

  return (
    <InlineRemotionRuntimeErrorBoundary
      key={`${componentId ?? ''}:${source}`}
      componentId={componentId}
    >
      <Component {...componentProps} />
    </InlineRemotionRuntimeErrorBoundary>
  );
}
