LearnosityAmd.define(['jquery-v1.10.2'], (function ($) { 'use strict';

    /**
     * @param {object} $ jQuery
     * @param {object} $modalContainer container element as jQuery objet
     * @param {object} $modalHandle dragging handle element as jQuery object
     */
    function initModalDragAndDrop($, $modalContainer, $modalHandle) {
        let $dragging = null;
        let mouse;

        $('html').on('mousemove touchmove', function(e) {
            if ($dragging) {
                $dragging.offset({
                    top: e.pageY - mouse.top,
                    left: e.pageX - mouse.left,
                });
            }
        });

        $modalHandle.on('mousedown touchstart', function(e) {
            e.preventDefault();

            mouse = {
                left: e.offsetX,
                top: e.offsetY,
            };

            $dragging = $modalContainer;
        });

        $('html').on('mouseup touchend', function(e) {
            $dragging = null;
        });
    }

    /**
     * @param {object} $ jQuery
     * @param {object} $modalContainer container element as jQuery objet
     */
    function removeOnOutsideClickOrEsc($, $modalContainer) {
        $('html').on('mousedown touchstart', function(e) {
            const el = e.target;
            if (
                !el.closest('.graph-calculator-geogebra-container') &&
                        !el.closest('.lrn_calculator') &&
                        !el.closest('.ggb-calc-toggle') &&
                        !el.closest('.ggb-embed-toggle') &&
                        !el.closest('.custom-calculator-icon') &&
                        // a widget was clicked that's already detached (e.g. spotlight in Notes)
                        !el.className.startsWith('gwt-') &&
                        $modalContainer.is(':visible')
            ) {
                $modalContainer.hide();
            }
        });
        $modalContainer.find('.notranslate').on('keydown',
            (evt) => (evt.key == 'Escape') && $modalContainer.hide());
    }

    var popup = {initModalDragAndDrop, removeOnOutsideClickOrEsc};

    const templates = {
        app: '<div class="geogebra-exercise"></div>',
        button: '<button type="button" class="lrn_btn ggb-embed-toggle">' +
        '<span class="btn-label">Open Notes</span></button>',
        modalContainer: '<div class="graph-calculator-geogebra-container"></div>',
        modal: '<div class="graph-calculator-geogebra-modal"></div>',
        modalHandler: '<div class="graph-calculator-geogebra-handle">'+
        '<div class="lrn-drag-handler"><span></span><span></span><span></span><span></span></div>'+
        '<div class="close"></div></div>',
    };
    const defaultWidth = 750;
    const defaultHeight = 550;
    let libLoaded = false;
    const matApiParameters = ['enableRightClick', 'showToolBar', 'showMenuBar',
        'showAlgebraInput', 'enableShiftDragZoom', 'allowStyleBar'];
    let callbacks = null;

    /**
     * Load external dependencies
     * @param {function} callback called after dependencies loaded
     */
    function loadDependencies(callback) {
        const loadScript = function(src) {
            return new Promise((resolve) => {
                const head = document.getElementsByTagName('head')[0];
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                head.appendChild(script);
            });
        };
        if (callbacks === null) {
            callbacks = [callback];
            Promise.all([
                loadScript('https://www.geogebra.org/apps/deployggb.js'),
            ]).then(function() {
                libLoaded = true;
                callbacks && callbacks.forEach(function(fn) {
                    fn();
                });
            });
        } else {
            callbacks.push(callback);
        }
    }

    /**
     * Class function representing a GeoGebra question
     * @param {object} options question configuration and response
     * @param {object} tools allows creating Learnosity components (used for check button)
     */
    function GeogebraExercise(options, tools) {
        this.questionsApiVersion = options.questionsApiVersion;
        this.renderComponent = tools.renderComponent;
        this.events = options.events;
        this.validatePermanent = true;
        this.$el = options.$el;
        this.question = options.question;
        this.response = options.response || {};
        this.questionState = options.state;
        this.loadCallbacks = [];
        this.api = null;
        this.modalId = 'ggbAssess_' + Math.round(Math.random() * 1E12);
        const facade = options.getFacade();
        const that = this;
        facade.showSolution = function() {
            that.afterLoaded(function() {
                if (that.objectState) {
                    for (const label of Object.keys(that.objectState)) {
                        that.api.setFixed(label, ...that.objectState[label]);
                    }
                    delete(that.objectState);
                }
                that.api.setValue('showsolution', true);
            });
        };

        facade.resetValidationUI = function() {
            that.afterLoaded(function() {
                that.api.setValue('showsolution', false);
                that.api.setValue('showanswer', false);
                that.api.setValue('validate', false);
            });
        };

        this.events.on('validate', function(validationEvent) {
            that.afterLoaded(function() {
                that.showValidation(validationEvent);
            });
        });

        if (!libLoaded) {
            loadDependencies(function() {
                this.render();
            }.bind(this));
        } else {
            this.render();
        }
        this.events.trigger('ready');
    }

    const computeSeed = (responseId) => {
        let h = 0;
        for (let i = 8; i < responseId.length; i += 8) {
            h = h ^ parseInt(responseId.substring(i - 8, i));
        }
        return Math.abs(h);
    };

    const toBoolean = (param) => {
        // note that !!"false" === true, so this check is
        // necessary if the parameter might be a string
        if (typeof param == 'string') {
            return param == 'true';
        } else {
            return !!param;
        }
    };

    const applyPerspective = (defaultOptions, perspective) => {
        switch (perspective) {
        case 'AG': defaultOptions.appName = 'graphing'; break;
        case 'G': defaultOptions.appName = 'geometry'; break;
        case 'AT': defaultOptions.appName = '3d'; break;
        default: defaultOptions.perspective = perspective;
        }
    };

    Object.assign(GeogebraExercise.prototype, {
        afterLoaded: function(callback) {
            if (this.api) {
                callback();
            } else {
                this.loadCallbacks.push(callback);
            }
        },

        render: function() {
            this.$body = $('body');
            const isReview = this.questionState === 'review';
            if (this.question.is_popup) {
                this.$el.empty();
                const button = $(templates.button).appendTo(this.$el);
                button.on('click', () => {
                    if (this.$modalContainer) {
                        this.$modalContainer.toggle();
                        return;
                    }
                    this.$modalContainer = $(templates.modalContainer).appendTo(this.$body);
                    const $modalHandle = $(templates.modalHandler).appendTo(this.$modalContainer);
                    const $modal = $(templates.modal).appendTo(this.$modalContainer);
                    this.createApp($modal, this.question, this.response, isReview);
                    $modalHandle.find('.close')
                        .on('mousedown touchstart', () => this.$modalContainer.hide());
                    popup.initModalDragAndDrop($, this.$modalContainer, $modalHandle);
                    const top = $(document).scrollTop() + 10;
                    const left = (window.innerWidth / 2) -
                        (parseFloat(this.question.width || defaultWidth) / 2);
                    this.$modalContainer.css({
                        top: top,
                        left: left,
                    });
                    popup.removeOnOutsideClickOrEsc($, this.$modalContainer);
                });
            } else {
                this.createApp(this.$el, this.question, this.response, isReview);
            }
        },

        showValidation: function(options) {
            this.blockListeners = true;
            const showAnswer = this.api.getValueString('showanswer');
            if (showAnswer && options && options.showCorrectAnswers) {
                this.api.setValue('showanswer', 1);
            } else {
                this.api.setValue('validate', 1);
            }

            this.blockListeners = false;
        },
        parseAdvanced: function(question, defaultOptions) {
            console.log(question.advanced);
            try {
                const advanced = JSON.parse(question.advanced || '{}');
                for (const key in advanced) {
                    if (advanced.hasOwnProperty(key)) {
                        defaultOptions[key] = advanced[key];
                    }
                }
            } catch (e) {
                console.log('Error handling advanced properties: ' + question.advanced);
            }
        },
        createApp: function(target, question, response, review) {
            const setMaterial = (opt, url) => {
                if (url.match(/ggbm.at/) || url.match(/geogebra.org\/m/)) {
                    opt.material_id = url.split('/').reverse()[0];
                } else {
                    opt.filename = url;
                }
            };
            target.empty();
            $('<div class="ggb-validation">').appendTo(target);
            const that = this;
            const $app = $(templates.app).appendTo(target);
            if (question.instant_feedback && !review) {
                const button = $('<div/>');
                this.renderComponent('CheckAnswerButton', button[0]);
                button.appendTo(target);
                button.on('click', function() {
                    that.validatePermanent = false;
                });
            }
            const events = this.events;
            const updateScore = function(objName, undoPoint) {
                clearTimeout(that.updateBatchTimer);
                const api = that.api;
                const val = api.getExerciseFraction();
                const maxScore = api.getValue('maxscore');
                if (val < 1 && objName != 'validate' && api.getValue('validate') > 0 &&
                    !that.blockListeners && !that.validatePermanent) {
                    api.setValue('validate', 0);
                }
                const fraction = response.fraction || 0;
                if (fraction != val || undoPoint) {
                    const evt = {'base64': api.getBase64(), 'ggbVersion': api.getVersion()};
                    if (question.custom_type == 'exercise_geogebra') {
                        Object.assign(evt, {'fraction': val, 'max_score': maxScore,
                            'thumbnailBase64': api.getThumbnailBase64(),
                            'ggbSeed': defaultOptions.randomSeed});
                        const appletParameters = $app.find('.appletParameters');
                        for (const apiParameter of matApiParameters) {
                            evt[apiParameter] = toBoolean(appletParameters.attr('data-param-' +
                             apiParameter));
                        }
                    }
                    events.trigger('changed', evt);
                } else {
                    // in most cases the update batch timer will be canceled on undo point
                    // but if JS is used we may not always get an undo point
                    that.updateBatchTimer = setTimeout(() => updateScore(objName, true), 1000);
                }
                response.fraction = val;
            };
            const storeError = function(error) {
                events.trigger('changed', {'error': error});
            };
            const height = question.height || defaultHeight;
            const enableUndoRedo = question.undo_redo || false;
            target.css('minHeight', height);
            const defaultOptions = {
                'id': that.modalId,
                'width': question.width || defaultWidth,
                'height': height,
                'borderColor': null,
                'enableLabelDrags': false,
                'showLogging': false,
                'useBrowserForJS': false,
                'scaleContainerClass': 'learnosity-item',
                'randomSeed': computeSeed(this.question.response_id),
                'enableUndoRedo': enableUndoRedo,
                'onError': function() {
                    storeError(`Could not fetch ${that.modalId} from api`);
                },
                'appletOnLoad': function(api) {
                    that.api = api;
                    if (question.custom_type == 'exercise_geogebra') {
                        setTimeout(() => {
                            if (api.getFileLoadingError()) {
                                storeError(JSON.stringify(api.getFileLoadingError()));
                            }
                        }, 0);
                    }
                    if (review) {
                        that.initReviewMode();
                    }
                    $.each(that.loadCallbacks, Object.call);
                    that.loadCallbacks = [];
                    if (!review) {
                        api.registerUpdateListener(updateScore, question.scoring_object);
                        api.registerStoreUndoListener(function(a) {
                            updateScore(a, true);
                        });
                        if (question.custom_type == 'exercise_geogebra') {
                            api.registerClientListener(function(a) {
                                if (a.type == 'editorKeyTyped') {
                                    updateScore(a, true);
                                }
                            });
                        }
                    }
                },
            };
            this.parseAdvanced(question, defaultOptions);
            if (response.base64) {
                for (const apiParameter of matApiParameters) {
                    defaultOptions[apiParameter] = toBoolean(response[apiParameter]);
                }
                defaultOptions.ggbBase64 = response.base64;
                defaultOptions.randomize = false;
            } else {
                setMaterial(defaultOptions, question.material || '');
            }
            if (question.custom_type == 'notes_geogebra') {
                const advanced = question.apptype == 'advanced';
                console.log(defaultOptions,'defaultOptions');
                Object.assign(defaultOptions, {
                    'appName': 'notes',
                    'showToolBar': !review,
                    'showMenuBar': false,
                    'allowStyleBar': true,
                   'customToolbox': 'select,pen,shapes,text,ruler' + (advanced ? ',shapes,more' : ''),
                });
            }
            if (question.custom_type == 'calculator_geogebra') {
                applyPerspective(defaultOptions, question.perspective || 'AG');
                Object.assign(defaultOptions, {
                    'allowStyleBar': true,
                    'showAlgebraInput': true,
                    'showToolBar': !review && (question.showtoolbar || false),
                    'showMenuBar': false,
                    'showToolBarHelp': question.showtoolbarhelp || false,
                });
            }
            if (question.custom_type == 'exercise_geogebra' && $app[0].closest('.slides-container')) {
                defaultOptions.detachedKeyboardParent = ".slides-container";
            }
            // Initialise
            this.appletInstance = new GGBApplet(defaultOptions, '5.0', true);
            if (question.codebase) {
                this.appletInstance.setHTML5Codebase(question.codebase);
            }
            // Render
            this.appletInstance.inject($app[0], 'preferhtml5');

            this.$app = $app;
        },

        initReviewMode: function() {
            const api = this.api;
            const elements = api.getAllObjectNames();
            this.objectState = {};
            for (const element of elements) {
                if (element != 'showsolution') {
                    this.objectState[element] = [api.isFixed(element),
                        api.isSelectionAllowed(element)];
                    api.setFixed(element, true, false);
                }
            }
        },

    });

    var geogebraCalculator = {
        Question: GeogebraExercise,
    };

    return geogebraCalculator;

}));
