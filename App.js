var acceptedPointsData = [];
var acceptedCountData = [];
var myMask = null;
var app = null;
var showAssignedProgram = true;

Ext.define('CustomApp', {
    scopeType: 'release',
    extend: 'Rally.app.App',
    componentCls: 'app',

    series : [
        { name : "PreliminaryEstimate",      description : "Preliminary Estimate",  field : "CalcPreliminaryEstimate", display : "line", f : "sum", color : "Orange" },
        { name : "StoryPoints" ,             description : "Story Points",          field : "LeafStoryPlanEstimateTotal",   display : "line", f : "sum", color : "DarkGray" },
        { name : "StoryCount"  ,             description : "Story Count" ,          field : "LeafStoryCount",          display : "line", f : "sum", color : "DarkGray" },
        { name : "StoryPointsProjection",    description : "Scope Projection",   projectOn : "Story Points", color : "LightGray" },
        { name : "StoryCountProjection",     description : "Count Projection",   projectOn : "Story Count", color : "LightGray" },
        { name : "AcceptedStoryPoints",      description : "Accepted Points",       field : "AcceptedLeafStoryPlanEstimateTotal", display : "line", f : "sum", color : "Green" },
        { name : "AcceptedStoryCount",       description : "Accepted Count",        field : "AcceptedLeafStoryCount",  display : "line", f : "sum", color : "Green" },
        { name : "AcceptedPointsProjection", description : "Accepted Projection", projectOn : "Accepted Points", color : "LightGray" },
        { name : "AcceptedCountProjection",  description : "Accepted Count Projection", projectOn : "Accepted Count", color : "LightGray" },
        { name : "FeatureCount",             description : "Feature Count",          field : "ObjectID",                display : "column", f : "count", color : "Blue" },
        { name : "FeatureCountCompleted",    description : "Completed Feature Count",field : "Completed",               display : "column", f : "sum", color : "Green" }
    ],

    defaultValues : function() {

        var obj = {
            releases      : "2014 Q2",
            pointsOrCount : "Points"
        };

        _.each(series,function(s) {
           obj[s.description] = s.defaultOn;
        });

        return obj;
    },

    // switch to app configuration from ui selection
    config: {
        defaultSettings : {
            releases                : "2014 Q2",
            pointsOrCount           : "Points",
            PreliminaryEstimate     : true,
            StoryPoints             : true,
            StoryCount              : false,
            StoryPointsProjection   : true,
            StoryCountProjection    : false,
            AcceptedStoryPoints     : true,
            AcceptedStoryCount      : false,
            AcceptedPointsProjection: true,
            AcceptedCountProjection : false,
            FeatureCount            : false,
            FeatureCountCompleted   : false
        }
    },

    getSettingsFields: function() {

        var checkValues = _.map(this.series,function(s) {
            return { name : s.name, xtype : 'rallycheckboxfield', label : s.description};
        });

        var values = [
            {
                name: 'releases',
                xtype: 'rallytextfield',
                label : "Release names to be included (comma seperated)"
            },
            {
                name: 'pointsOrCount',
                xtype: 'rallytextfield',
                label: 'Points or Count'
            }
        ];

        return values.concat(checkValues);
    },

    launch: function() {

        app = this;
        app.configReleases = app.getSetting("releases");
        app.configPointsOrCount = app.getSetting("pointsOrCount");

        if (app.configReleases==="") {
            this.add({html:"Please Configure this app by selecting Edit App Settings from Configure (gear) Menu"});
            return;
        }

        var that = this;
        // get the project id.
        this.project = this.getContext().getProject().ObjectID;

        // get the release (if on a page scoped to the release)
        var tbName = getReleaseTimeBox(this);
        // release selected page will over-ride app config
        app.configReleases = tbName !== "" ? tbName : app.configReleases;

        var configs = [];
        
        // query for estimate values, releases and iterations.
        configs.push({ model : "PreliminaryEstimate", 
                       fetch : ['Name','ObjectID','Value'], 
                       filters : [] 
        });
        configs.push({ model : "Release",             
                       fetch : ['Name', 'ObjectID', 'Project', 'ReleaseStartDate', 'ReleaseDate' ], 
                       filters: [app.createReleaseFilter(app.configReleases)]
        });

        // get the preliminary estimate type values, and the releases.
        async.map( configs, app.wsapiQuery, function(err,results) {

            app.peRecords = results[0];
            app.releases  = results[1];

            configs = [
                {
                    model  : "Iteration",
                    fetch  : ['Name', 'ObjectID', 'Project', 'StartDate', 'EndDate' ],
                    filters: app.createIterationFilter(app.releases)
                }
            ];

            // get the iterations
            async.map( configs, app.wsapiQuery, function(err,results) {

                app.iterations = results[0];
                app.queryFeatures();

            });
        });
    },

    // remove leading and trailing spaces
    trimString : function (str) {
        return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
    },

    // creates a filter to return all releases with a specified set of names
    createReleaseFilter : function(releaseNames) {

        var filter = null;

        _.each( releaseNames.split(","), function( releaseName, i ) {
            if (releaseName !== "") {
                var f = Ext.create('Rally.data.wsapi.Filter', {
                        property : 'Name', operator : '=', value : app.trimString(releaseName) }
                );
                filter = (i===0) ? f : filter.or(f);
            }
        });

        console.log("Release Filter:",filter.toString());
        return filter;

    },

    createIterationFilter : function(releases) {

        var extent = app.getReleaseExtent(releases);

        var filter = Ext.create('Rally.data.wsapi.Filter', {
            property : 'EndDate', operator: ">=", value: extent.isoStart
        });

        filter = filter.and( Ext.create('Rally.data.wsapi.Filter', {
                property : 'EndDate', operator: "<=", value: extent.isoEnd
            })
        );

        return filter;
    },

    getReleaseExtent : function( releases ) {

        var start = _.min(_.pluck(releases,function(r) { return r.get("ReleaseStartDate");}));
        var end   = _.max(_.pluck(releases,function(r) { return r.get("ReleaseDate");}));
        var isoStart  = Rally.util.DateTime.toIsoString(start, false);
        var isoEnd    = Rally.util.DateTime.toIsoString(end, false);

        return { start : start, end : end, isoStart : isoStart, isoEnd : isoEnd };

    },

    // generic function to perform a web services query    
    wsapiQuery : function( config , callback ) {

        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });

    },

    queryFeatures : function() {

        myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Please wait..."});
        var filter = null;

        _.each( app.releases , function( release, i ) {
            var f = Ext.create('Rally.data.QueryFilter', {
                property: 'Release',
                operator: '=',
                value: release.get("_ref")
            });
            filter = i === 0 ? f : filter.or(f);
        });

        return Ext.create('Rally.data.WsapiDataStore', {
            autoLoad: true,
            model: 'PortfolioItem/Feature',
            limit : 'Infinity',
            fetch: ['ObjectID','FormattedID' ],
            filters: [filter],
            listeners: {
                load: function(store, features) {
                    console.log("Loaded:"+features.length," Features.");
                    app.features = features;
                    app.queryFeatureSnapshots();
                }
            }
        });        
    },
    
    queryFeatureSnapshots : function () {

        var ids = _.pluck(app.features, function(feature) { return feature.get("ObjectID");} );
        var extent = app.getReleaseExtent(app.releases);


        var storeConfig = {
            find : {
                '_TypeHierarchy' : { "$in" : ["PortfolioItem/Feature"] },
                'ObjectID' : { "$in" : ids },
                '_ValidTo' : { "$gte" : extent.isoStart }
            },
            autoLoad : true,
            pageSize:1000,
            limit: 'Infinity',
            fetch: ['_UnformattedID','ObjectID','_TypeHierarchy','PreliminaryEstimate', 'LeafStoryCount','LeafStoryPlanEstimateTotal','AcceptedLeafStoryPlanEstimateTotal','AcceptedLeafStoryCount','PercentDoneByStoryCount'],
            hydrate: ['_TypeHierarchy']
        };

        storeConfig.listeners = {
            scope : this,
            load: function(store, snapshots, success) {
                console.log("Loaded:"+snapshots.length," Snapshots.");
                app.createChartData(snapshots);
            }
        };

        var snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', storeConfig);
    },

    createChartData : function ( snapshots ) {
        
        var that = this;
        var lumenize = window.parent.Rally.data.lookback.Lumenize;
        var snapShotData = _.map(snapshots,function(d){return d.data;});
        var extent = app.getReleaseExtent(app.releases);

        var snaps = _.sortBy(snapShotData,"_UnformattedID");
        // can be used to 'knockout' holidays
        var holidays = [
            //{year: 2014, month: 1, day: 1}  // Made up holiday to test knockout
        ];
        var myCalc = Ext.create("MyBurnCalculator", { series : app.series });

        // calculator config
        var config = {
            deriveFieldsOnInput: myCalc.getDerivedFieldsOnInput(),
            metrics: myCalc.getMetrics(),
            summaryMetricsConfig: [],
            deriveFieldsAfterSummary: myCalc.getDerivedFieldsAfterSummary(),
            granularity: lumenize.Time.DAY,
            tz: 'America/Chicago',
            holidays: holidays,
            workDays: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'
        };
        // release start and end dates
        var startOnISOString = new lumenize.Time(extent.start).getISOStringInTZ(config.tz);
        var upToDateISOString = new lumenize.Time(extent.end).getISOStringInTZ(config.tz);
        // create the calculator and add snapshots to it.
        calculator = new lumenize.TimeSeriesCalculator(config);
        calculator.addSnapshots(snapShotData, startOnISOString, upToDateISOString);
        
        // create a high charts series config object, used to get the hc series data
        var hcConfig = [{ name : "label" }];
        _.each( app.series, function(s) {
            if ( app.getSetting(s.name)===true) {
                hcConfig.push({
                   name : s.description, type : s.display
                });
            }
        });
        var hc = lumenize.arrayOfMaps_To_HighChartsSeries(calculator.getResults().seriesData, hcConfig);
        this.showChart(app.trimHighChartsConfig(hc));
    },

    trimHighChartsConfig : function(hc) {

        // trim future values
        var today = new Date();
        _.each(hc, function(series,i) {
            // for non-projection values dont chart after today
            if (series.name.indexOf("Projection")===-1 && series.name.indexOf("label") ===-1 ) {
                _.each( series.data, function( point , x ){
                    if ( Date.parse(hc[0].data[x]) > today )
                        series.data[x] = null;
                });
            }
            // for projection null values before today.
            if (series.name.indexOf("Projection")!==-1) {
                _.each( series.data, function( point , x ){
                    if ( Date.parse(hc[0].data[x]) < today ) {
                        series.data[x] = null;

                    }
                });
                series.color = "#C8C8C8";
                series.dashStyle = 'dash';
            }

        });

        return hc;
    },
    
    createPlotLines : function(seriesData) {

        // filter the iterations
        var start = new Date( Date.parse(seriesData[0]));
        var end   = new Date( Date.parse(seriesData[seriesData.length-1]));
        var releaseI = _.filter(this.iterations,function(i) { return i.get("EndDate") >= start && i.get("EndDate") <= end;});
        releaseI = _.uniq(releaseI,function(i) { return i.get("Name");});
        var itPlotLines = _.map(releaseI, function(i){
            var d = new Date(Date.parse(i.raw.EndDate)).toISOString().split("T")[0];
            return {
                label : i.get("Name"),
                dashStyle : "Dot",
                color: 'grey',
                width: 1,
                value: _.indexOf(seriesData,d)
            }; 
        });
        // create release plot lines        
        var rePlotLines = _.map(this.selectedReleases, function(i){
            var d = new Date(Date.parse(i.raw.ReleaseDate)).toISOString().split("T")[0];
            return {
                label : i.get("Name"),
                // dashStyle : "Dot",
                color: 'grey',
                width: 1,
                value: _.indexOf(seriesData,d)
            }; 
        });
        return itPlotLines.concat(rePlotLines);

    },

    createColorsArray : function(series) {

        var colors = [];

        _.each( series, function(s,i) {
            if (i>0) {
                var as = _.find( app.series, function(a) {
                    return a.description === s.name;
                });
                colors.push(as.color);
            }
        });

        return colors;

    },

    showChart : function(series) {

        console.log("series",series);
        var that = this;
        var chart = this.down("#chart1");
        myMask.hide();
        if (chart !== null)
            chart.removeAll();
            
        // create plotlines
        var plotlines = this.createPlotLines(series[0].data);
        
        // set the tick interval
        var tickInterval = series[1].data.length <= (7*20) ? 7 : (series[1].data.length / 20);

        // series[1].data = _.map(series[1].data, function(d) { return _.isNull(d) ? 0 : d; });

        var extChart = Ext.create('Rally.ui.chart.Chart', {
            columnWidth : 1,
            itemId : "chart1",
            chartData: {
                categories : series[0].data,
                series : series.slice(1, series.length)
            },

//            chartColors: ['Gray', 'Orange', 'LightGray', 'LightGray', 'LightGray', 'Blue','Green'],
            chartColors : app.createColorsArray(series),

            chartConfig : {
                chart: {
                },
                title: {
                text: 'PSI Feature Burnup',
                x: -20 //center
                },
                plotOptions: {
                    series: {
                        marker: {
                            radius: 2
                        }
                    }
                },
                xAxis: {
                    plotLines : plotlines,
                    //tickInterval : 7,
                    tickInterval : tickInterval,
                    type: 'datetime',
                    labels: {
                        formatter: function() {
                            return Highcharts.dateFormat('%b %d', Date.parse(this.value));
                        }
                    }
                },
                yAxis: {
                    title: {
                        text: that.pointsUnitType() ? 'Points':'Count'
                    },
                    plotLines: [{
                        value: 0,
                        width: 1,
                        color: '#808080'
                    }]
                },
                tooltip: {
                },
                legend: { align: 'center', verticalAlign: 'bottom' }
            }
        });
        this.add(extChart);
        chart = this.down("#chart1");
        var p = Ext.get(chart.id);
        elems = p.query("div.x-mask");
        _.each(elems, function(e) { e.remove(); });
        var elems = p.query("div.x-mask-msg");
        _.each(elems, function(e) { e.remove(); });

    },

    pointsUnitType : function() {
        return app.configPointsOrCount === "Points";

    }

});
