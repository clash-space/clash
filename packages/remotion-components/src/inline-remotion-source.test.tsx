// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Remotion from 'remotion';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RemotionSourceComposition,
  compileInlineRemotionSource,
} from './inline-remotion-source';

const VALID_SOURCE = `
  import { createElement } from 'react';
  import { interpolate } from 'remotion';

  type CardProps = {
    label: string;
    expectedCreateElement: unknown;
    expectedInterpolate: unknown;
  };

  export default function InlineCard(props: CardProps) {
    return (
      <div
        data-react-singleton={String(createElement === props.expectedCreateElement)}
        data-remotion-singleton={String(interpolate === props.expectedInterpolate)}
      >
        {props.label}
      </div>
    );
  }
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inline Remotion TSX source runtime', () => {
  it('transpiles a default-exported TSX component with the host React and Remotion singletons', () => {
    const Component = compileInlineRemotionSource(VALID_SOURCE);
    const markup = renderToStaticMarkup(
      <Component
        label="Shared runtime"
        expectedCreateElement={React.createElement}
        expectedInterpolate={Remotion.interpolate}
      />,
    );

    expect(markup).toContain('data-react-singleton="true"');
    expect(markup).toContain('data-remotion-singleton="true"');
    expect(markup).toContain('Shared runtime');
    expect(compileInlineRemotionSource(VALID_SOURCE)).toBe(Component);
  });

  it('exposes the official Remotion skill markup primitives to inline Canvas components', () => {
    const Component = compileInlineRemotionSource(`
      import { CanvasImage, Easing, Interactive } from 'remotion';

      export default function OfficialSkillRuntime() {
        const supported = Boolean(
          CanvasImage
          && Interactive?.Div
          && typeof Easing.spring === 'function'
        );
        return <div data-official-skill-runtime={String(supported)} />;
      }
    `);

    expect(renderToStaticMarkup(<Component />)).toContain(
      'data-official-skill-runtime="true"',
    );
  });

  it('rejects source imports outside react and remotion', () => {
    expect(() => compileInlineRemotionSource(`
      import { readFile } from 'node:fs/promises';
      export default function BadImport() { return <div>{String(readFile)}</div>; }
    `)).toThrow(/only import from "react" or "remotion"/i);

    expect(() => compileInlineRemotionSource(`
      export default function DynamicImport() {
        void import('react');
        return <div />;
      }
    `)).toThrow(/dynamic imports are not supported/i);

    expect(() => compileInlineRemotionSource(`
      export default function RequireCall() {
        require('remotion');
        return <div />;
      }
    `)).toThrow(/require\(\) is not supported/i);
  });

  it('requires the evaluated module to have a default component export', () => {
    expect(() => compileInlineRemotionSource(`
      export const NamedOnly = () => <div />;
    `)).toThrow(/default export/i);
  });

  it('renders compilation diagnostics visibly', () => {
    const markup = renderToStaticMarkup(
      <RemotionSourceComposition
        componentId="canvas-card"
        source={`
          import thing from 'not-allowed';
          export default function Invalid() { return <div>{thing}</div>; }
        `}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-inline-remotion-error="compile"');
    expect(markup).toContain('data-remotion-component-id="canvas-card"');
    expect(markup).toMatch(/only import from &quot;react&quot; or &quot;remotion&quot;/i);
  });

  it('renders runtime failures visibly and recovers when source is updated', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RemotionSourceComposition
          componentId="timeline-title"
          source={`
            export default function Explodes() { throw new Error('frame exploded'); }
          `}
        />,
      );
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/frame exploded/i);
    expect(container.querySelector('[data-inline-remotion-error="runtime"]')).not.toBeNull();

    act(() => {
      root.render(
        <RemotionSourceComposition
          componentId="timeline-title"
          source={`export default function Recovered() { return <div>Recovered frame</div>; }`}
        />,
      );
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Recovered frame');

    act(() => root.unmount());
    container.remove();
    expect(consoleError).toHaveBeenCalled();
  });
});
