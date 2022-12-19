/* Copyright 2019 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

import {TestBed} from '@angular/core/testing';
import {provideMockActions} from '@ngrx/effects/testing';
import {Action, Store} from '@ngrx/store';
import {MockStore, provideMockStore} from '@ngrx/store/testing';
import {ReplaySubject} from 'rxjs';
import {
  TBFeatureFlagTestingModule,
  TestingTBFeatureFlagDataSource,
} from '../../webapp_data_source/tb_feature_flag_testing';
import {
  allFeatureFlagOverridesReset,
  featureFlagOverrideChanged,
  featureFlagOverridesReset,
  partialFeatureFlagsLoaded,
} from '../actions/feature_flag_actions';
import {ForceSvgDataSource} from '../force_svg_data_source';
import {ForceSvgDataSourceModule} from '../force_svg_data_source_module';
import {FeatureFlagMetadataMap} from '../store/feature_flag_metadata';
import {
  getFeatureFlags,
  getFeatureFlagsMetadata,
  getFeatureFlagsToSendToServer,
  getIsAutoDarkModeAllowed,
} from '../store/feature_flag_selectors';
import {State} from '../store/feature_flag_types';
import {buildFeatureFlag} from '../testing';
import {FeatureFlags} from '../types';
import {FeatureFlagEffects} from './feature_flag_effects';

describe('feature_flag_effects', () => {
  let actions: ReplaySubject<Action>;
  let store: MockStore<State>;
  let dataSource: TestingTBFeatureFlagDataSource;
  let forceSvgDataSource: ForceSvgDataSource;
  let effects: FeatureFlagEffects;
  let setPolymerFeatureFlagsSpy: jasmine.Spy;

  beforeEach(async () => {
    actions = new ReplaySubject<Action>(1);
    await TestBed.configureTestingModule({
      imports: [TBFeatureFlagTestingModule, ForceSvgDataSourceModule],
      providers: [
        provideMockActions(actions),
        FeatureFlagEffects,
        provideMockStore(),
      ],
    }).compileComponents();

    setPolymerFeatureFlagsSpy = jasmine.createSpy('setFeatureFlags');
    const createElementSpy = spyOn(document, 'createElement');
    createElementSpy.withArgs('tf-feature-flags').and.returnValue({
      tf_feature_flags: {
        setFeatureFlags: setPolymerFeatureFlagsSpy,
      },
    } as unknown as HTMLElement);
    createElementSpy.and.callThrough();

    effects = TestBed.inject(FeatureFlagEffects);
    store = TestBed.inject<Store<State>>(Store) as MockStore<State>;
    dataSource = TestBed.inject(TestingTBFeatureFlagDataSource);
    forceSvgDataSource = TestBed.inject(ForceSvgDataSource);
    store.overrideSelector(getIsAutoDarkModeAllowed, false);
    store.overrideSelector(getFeatureFlagsMetadata, FeatureFlagMetadataMap);
  });

  afterEach(() => {
    store?.resetSelectors();
  });

  describe('getFeatureFlags$', () => {
    let recordedActions: Action[];

    beforeEach(() => {
      recordedActions = [];
      effects.getFeatureFlags$.subscribe((action) => {
        recordedActions.push(action);
      });
    });

    it('loads features from the data source on init', () => {
      spyOn(dataSource, 'getFeatures').and.returnValue(
        buildFeatureFlag({
          enabledExperimentalPlugins: ['foo', 'bar'],
          inColab: false,
        })
      );

      actions.next(effects.ngrxOnInitEffects());

      expect(recordedActions).toEqual([
        partialFeatureFlagsLoaded({
          features: buildFeatureFlag({
            enabledExperimentalPlugins: ['foo', 'bar'],
            inColab: false,
          }),
        }),
      ]);
    });

    it('calls updateForceSvgFlag when getFeatures returns a value for forceSvg', () => {
      spyOn(dataSource, 'getFeatures').and.returnValue(
        buildFeatureFlag({
          forceSvg: true,
        })
      );
      let updateSpy = spyOn(
        forceSvgDataSource,
        'updateForceSvgFlag'
      ).and.stub();

      actions.next(effects.ngrxOnInitEffects());

      expect(recordedActions).toEqual([
        partialFeatureFlagsLoaded({
          features: buildFeatureFlag({
            forceSvg: true,
          }),
        }),
      ]);

      expect(updateSpy).toHaveBeenCalledOnceWith(true);
    });

    it('gets forceSVG flag from ForceSvgDataSource when getFeatures returns no value for forceSvg', () => {
      let featureFlags: Partial<FeatureFlags> = buildFeatureFlag();
      delete featureFlags.forceSvg;
      spyOn(dataSource, 'getFeatures').and.returnValue(featureFlags);
      let updateSpy = spyOn(
        forceSvgDataSource,
        'updateForceSvgFlag'
      ).and.stub();
      let getSpy = spyOn(forceSvgDataSource, 'getForceSvgFlag').and.returnValue(
        true
      );

      actions.next(effects.ngrxOnInitEffects());

      expect(recordedActions).toEqual([
        partialFeatureFlagsLoaded({
          features: buildFeatureFlag({
            forceSvg: true,
          }),
        }),
      ]);

      expect(getSpy).toHaveBeenCalledOnceWith();
      expect(updateSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('updatePolymerFeatureFlags$', () => {
    it('sets polymer feature flags after data source fetch', () => {
      // This represents the complete FeatureFlags object as calculated by the
      // Store after the feature flags data source fetch.
      store.overrideSelector(
        getFeatureFlags,
        buildFeatureFlag({inColab: true})
      );
      store.overrideSelector(getFeatureFlagsToSendToServer, {
        scalarsBatchSize: 10,
      });
      store.refreshState();

      effects.updatePolymerFeatureFlags$.subscribe();

      actions.next(
        partialFeatureFlagsLoaded({
          // This represents the incomplete FeatureFlags object that has just
          // been fetched by the feature flags data source.
          features: buildFeatureFlag({inColab: false}),
        })
      );

      expect(setPolymerFeatureFlagsSpy).toHaveBeenCalledOnceWith(
        // Uses the FeatureFlags object from the Store and not from the action.
        buildFeatureFlag({inColab: true}),
        {scalarsBatchSize: 10}
      );
    });
  });

  describe('storeFeatureFlag', () => {
    it('calls persistFeatureFlags', () => {
      const persistFlagSpy = spyOn(
        dataSource,
        'persistFeatureFlags'
      ).and.stub();
      effects.storeFeatureFlag$.subscribe();

      actions.next(
        featureFlagOverrideChanged({
          flags: {enabledScalarDataTable: true},
        })
      );

      expect(persistFlagSpy).toHaveBeenCalledOnceWith({
        enabledScalarDataTable: true,
      });
    });
  });

  describe('resetFeatureFlagOverrides', () => {
    it('calls resetPersistedFeatureFlag', () => {
      const resetFlagSpy = spyOn(
        dataSource,
        'resetPersistedFeatureFlag'
      ).and.stub();
      effects.resetFeatureFlagOverrides$.subscribe();
      actions.next(featureFlagOverridesReset({flags: ['inColab']}));
      expect(resetFlagSpy).toHaveBeenCalledOnceWith('inColab');
    });
  });

  describe('resetAllFeatureFlagOverrides', () => {
    it('calls resetAllPersistedFeatureFlags', () => {
      const resetAllFlagsSpy = spyOn(
        dataSource,
        'resetAllPersistedFeatureFlags'
      ).and.stub();
      effects.resetAllFeatureFlagOverrides$.subscribe();
      actions.next(allFeatureFlagOverridesReset());
      expect(resetAllFlagsSpy).toHaveBeenCalledOnceWith();
    });
  });
});
