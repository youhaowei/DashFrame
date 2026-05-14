import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

type Loader<TProps> = () => Promise<
  ComponentType<TProps> | { default: ComponentType<TProps> }
>;

type DynamicOptions = {
  // Accepted for Next compat. No-op in Vite — there's no SSR to opt out of.
  // Callers passing `{ ssr: false }` (e.g. for Vega-Lite, which can't be
  // serialized through Next's RSC) work the same either way here.
  ssr?: boolean;
  loading?: ComponentType;
};

export default function dynamic<TProps extends object>(
  loader: Loader<TProps>,
  options: DynamicOptions = {},
): ComponentType<TProps> {
  const LazyComponent = lazy(async () => {
    const loaded = await loader();
    return "default" in loaded ? loaded : { default: loaded };
  }) as LazyExoticComponent<ComponentType<TProps>>;

  return function DynamicComponent(props: TProps) {
    const Loading = options.loading;

    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
