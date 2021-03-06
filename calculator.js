Ext.define("MyBurnCalculator", function() {

    var self;

    return {

        extend: "Rally.data.lookback.calculator.TimeSeriesCalculator",

        config : {
            series : [],
            ignoreZeroValues : true,
            peRecords : []

        },

        constructor:function(config) {
            self = this;
            this.initConfig(config);
            return this;
        },

        pointsOffset : [],
        countOffset : [],
        data : [],
        indexOffset : [],

        getMetrics: function () {

            // get the set of non-projection metrics
            var nonProjectionMetrics = _.filter(self.series,function(s) {
               return s.name.indexOf("Projection")==-1;
            });

            var metrics = _.map( nonProjectionMetrics, function(m) {
                return {
                    field : m.field,
                    as : m.description,
                    display : m.display,
                    f : m.f
                };
            });

            return metrics;
        },

        getDerivedFieldsOnInput : function () {
            // XS 1, S 3, M 5, L 8, XL 13
            return [
                {
                    as: 'CalcPreliminaryEstimate',
                    f:  function(row) {
                        var r = _.find(self.peRecords, function(rec) { return rec.get("ObjectID") == row.PreliminaryEstimate; });
                        return r !== undefined ? r.get("Value") : 0;
                    }
                },
                {
                    as: 'Completed',
                    f:  function(row) {
                    return row.PercentDoneByStoryCount == 1 ? 1 : 0;
                    }
                }
            ];
        },

        calcProjectionPoint : function(seriesName,row, index, summaryMetrics, seriesData) {

            var that = this;

            // for first point we save the data set on which we are going to do the linear projection on
            // we also optionally filter out values.
            if (index === 0) {
                datesData = _.pluck(seriesData,"label");
                var today = new Date();
                var li = datesData.length-1;

                that.data[seriesName] = _.pluck(seriesData,seriesName);
                // filter to just values before today
                that.data[seriesName] = _.filter(
                    that.data[seriesName], function(d,i) {
                        return new Date(Date.parse(datesData[i])) < today;
                    }
                );
                // optionally remove zero values
                var dx = that.data[seriesName].length;
                if (self.ignoreZeroValues===true) {
                    that.data[seriesName] = _.filter(
                        that.data[seriesName], function(d,i) {
                            return d !== 0;
                        }
                    );
                }
                // if we do remove values from the data set then we need to save an offset
                // so we are calculating the projection on the revised length
                var dy = that.data[seriesName].length;
                that.indexOffset[seriesName] = dx - dy;

                // calculate an offset between the projected value and the actual accepted values.
                var lastAccepted = that.data[seriesName][that.data[seriesName].length-1];
                var lastProjected = linearProject( that.data[seriesName], that.data[seriesName].length-1);
                that.pointsOffset[seriesName] = lastAccepted-lastProjected;
            }
            index = index - that.indexOffset[seriesName];
            var y = linearProject( that.data[seriesName], index) + that.pointsOffset[seriesName];
            return Math.round(y * 100) / 100;
        },

        getDerivedFieldsAfterSummary : function () {

            // get the set of projection metrics
            var projectionMetrics = _.filter(self.series,function(s) {
                return s.name.indexOf("Projection")!==-1;
            });

            var metrics = _.map( projectionMetrics, function(m) {
                return {
                    as : m.description,
                    projectOn : m.projectOn,
                    f : function(row,index,summaryMetrics,seriesData) {
                        var p = self.calcProjectionPoint(this.projectOn,row,index,summaryMetrics,seriesData);
                        return p;
                    }
                };
            });
            return metrics;

        },

        defined : function(v) {
            return (!_.isUndefined(v) && !_.isNull(v));
        }
    };
   
});
