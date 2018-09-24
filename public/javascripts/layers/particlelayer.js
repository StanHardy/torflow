/**
 Copyright 2016 Uncharted Software Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

(function() {
    'use strict';

    var Config = require('../config.js');
    var WebGLOverlay = require('./webgloverlay');
    var LoadingBar = require('../ui/loadingbar');

    var IS_MOBILE = require('../util/mobile').IS_MOBILE;
    var PARTICLE_COUNT = IS_MOBILE ? Config.particle_count * Config.particle_mobile_factor : Config.particle_count;
    var PARTICLE_COUNT_MIN = IS_MOBILE ? Config.particle_count_min * Config.particle_mobile_factor : Config.particle_count_min;
    var PARTICLE_COUNT_MAX = IS_MOBILE ? Config.particle_count_max * Config.particle_mobile_factor : Config.particle_count_max;

    var ParticleLayer = WebGLOverlay.extend({

        initShaders: function( done ) {
            this._shader = new esper.Shader({
                vert: '../../shaders/particle.vert',
                frag: '../../shaders/particle.frag'
            }, function() {
                // execute callback
                done();
            });
        },

        initBuffers: function( done ) {
            var bufferSize =  Config.particle_count_max * 4 * 2;
            // create vertex buffer, this will never be updated
            this._vertexBuffer = new esper.VertexBuffer( bufferSize, {
                /**
                 * x: startX
                 * y: startY
                 * y: endX
                 * w: endY
                 */
                0: {
                    size: 4,
                    type: 'FLOAT',
                    offset: 0
                },
                /**
                 * x: t0
                 * y: offset0
                 * y: t1
                 * w: offset1
                 */
                1: {
                    size: 4,
                    type: 'FLOAT',
                    offset: 16
                }
            });
            // execute callback
            done();
        },

        updateNodes: function(nodes, bandwidth) {
            if (!this._gl) {
                return;
            }
            var self = this;
            if (nodes) {
                this._nodes = nodes;
            }
            if (bandwidth) {
                this._currentBandwidth = bandwidth;
            }
            // prepare loading bar
            if ( this._loadingBar ) {
                this._loadingBar.cancel();
            }
            this._loadingBar = new LoadingBar();
            // clear and flag as not ready to draw
            this.clear();
            // terminate existing worker
            if ( this._worker ) {
                this._worker.terminate();
            }
            // create web worker to generate particles
            this._worker = new Worker('javascripts/particles/particlesystem.js');
            this._worker.addEventListener('message', function( e ) {
                switch ( e.data.type ) {
                    case 'progress':
                        self._loadingBar.update( e.data.progress );
                        break;
                    case 'complete':
                        this._loadingBar = null;
                        self._vertexBuffer.bufferData( new Float32Array( e.data.buffer ) );
                        self._timestamp = Date.now();
                        if (self._prevReady !== undefined) {
                            // flag as ready to draw once zooming ends
                            self._prevReady = true;
                        } else {
                            // flag as ready to draw
                            self._isReady = true;
                        }
                        self._worker.terminate();
                        self._worker = null;
                        break;
                }
            });
            // start the webworker
            this._worker.postMessage({
                type: 'start',
                spec: {
                    offset: Config.particle_offset,
                    count: this.getUnscaledParticleCount()
                },
                nodes: this._nodes
            });
        },

        _drawHiddenServices: function() {
            var hiddenServicesCount = Math.floor(Config.hiddenServiceProbability * this.getParticleCount());
            this._shader.setUniform( 'uColor', Config.particle_hidden_color);
            this._vertexBuffer.draw({
                mode: 'POINTS',
                offset: 0,
                count: hiddenServicesCount
            });
        },

        _drawGeneralServices: function() {
            var hiddenServicesCount = Math.floor(Config.hiddenServiceProbability * this.getParticleCount()),
                generalServicesCount = this.getParticleCount() - hiddenServicesCount;
            this._shader.setUniform( 'uColor', Config.particle_general_color);
            this._vertexBuffer.draw({
                mode: 'POINTS',
                offset: hiddenServicesCount,
                count: generalServicesCount
            });
        },

        showTraffic: function(state) {
            if (state !== undefined) {
                this._showTraffic = state;
                return this;
            } else {
                return this._showTraffic;
            }
        },

        setSpeed: function( speed ) {
            this._speed = speed;
        },

        getSpeed: function() {
            return this._speed !== undefined ? this._speed : 1.0;
        },

        setPathOffset: function( offset ) {
            this._pathOffset = offset;
        },

        getPathOffset: function() {
            return this._pathOffset !== undefined ? this._pathOffset : 1.0;
        },

        setParticleSize: function(size) {
            this._particleSize = size;
            if ( Config.particle_zoom_scale ) {
                return Config.particle_zoom_scale( this._map.getZoom(), Config.particle_size );
            }
            return Config.particle_size;
        },

        getParticleSize: function() {
            if ( this.scaleSizeByZoom() ) {
                return Config.particle_zoom_scale( this._map.getZoom(), this._particleSize || Config.particle_size );
            }
            return this._particleSize || Config.particle_size;
        },

        setParticleCount: function(count) {
            this._particleCount = count;
            this.updateNodes();
        },

        getParticleCount: function() {
            var MIN_SCALE = 0.1;
            if ( this.scaleCountByBandwidth() ) {
                var scale = ( this._currentBandwidth - this._minBandwidth ) / (this._maxBandwidth - this._minBandwidth);
                return this.getUnscaledParticleCount() * Math.max(scale, MIN_SCALE);
            }
            return this.getUnscaledParticleCount();
        },

        getUnscaledParticleCount: function() {
            return this._particleCount || PARTICLE_COUNT;
        },

        getParticleCountMin: function() {
            return PARTICLE_COUNT_MIN;
        },

        getParticleCountMax: function() {
            return PARTICLE_COUNT_MAX;
        },

        setOpacity: function( opacity ) {
            this._opacity = opacity;
        },

        getOpacity: function() {
            return this._opacity !== undefined ? this._opacity : 1.0;
        },

        scaleSizeByZoom: function(scaleSizeByZoom) {
            if ( scaleSizeByZoom !== undefined ) {
                this._scaleSizeByZoom = scaleSizeByZoom;
                return this;
            }
            return this._scaleSizeByZoom !== undefined ? this._scaleSizeByZoom : false;
        },

        setBandwidthMinMax: function(min, max) {
            this._minBandwidth = min;
            this._maxBandwidth = max;
        },

        scaleCountByBandwidth: function(scaleCountByBandwidth) {
            if ( scaleCountByBandwidth !== undefined ) {
                this._scaleCountByBandwidth = scaleCountByBandwidth;
                return this;
            }
            return this._scaleCountByBandwidth !== undefined ? this._scaleCountByBandwidth : false;
        },

        draw: function() {
            if (!this._gl) {
                return;
            }
            if (this._isReady) {
                // re-position canvas
                if ( !this._isZooming ) {
                    var topLeft = this._map.containerPointToLayerPoint([0, 0]);
                    L.DomUtil.setPosition(this._canvas, topLeft);
                }
                var bounds = this._map.getPixelBounds(),
                    dim = Math.pow( 2, this._map.getZoom() ) * 256;
                var minX = bounds.min.x/dim, 
                    maxX = bounds.max.x/dim;
                
                // set uniforms
                this._viewport.push();
                this._shader.push();
                this._shader.setUniform( 'uProjectionMatrix', this._getProjection() );
                this._shader.setUniform( 'uTime', Date.now() - this._timestamp );
                this._shader.setUniform( 'uSpeedFactor', Config.particle_base_speed_ms / this.getSpeed() );
                this._shader.setUniform( 'uOffsetFactor', this.getPathOffset() );
                this._shader.setUniform( 'uPointSize', this.getParticleSize() );
                this._shader.setUniform( 'uOpacity', this.getOpacity() );
                this._shader.setUniform( 'uMinX', minX);
                this._shader.setUniform( 'uMaxX', maxX);

                // bind draw buffer
                this._vertexBuffer.bind();
                if (this._showTraffic === 'hidden') {
                    // draw hidden traffic
                    this._drawHiddenServices();
                } else if (this._showTraffic === 'general') {
                    // draw non-hidden traffic
                    this._drawGeneralServices();
                } else {
                    // draw all traffic
                    this._drawGeneralServices();
                    this._drawHiddenServices();
                }
                this._vertexBuffer.unbind();
                this._shader.pop();
                this._viewport.pop();
            }
        }

    });

    module.exports = ParticleLayer;

}());
